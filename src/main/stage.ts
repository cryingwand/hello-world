import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DisplayOffer } from '@shared/events'
import { DISPLAY_OFFER_CHANNEL } from '@shared/events'
import { kindOf, toFileUrl } from '@shared/files'
import {
  MAX_STAGE_ITEMS,
  STAGE_HOST,
  STAGE_STATE_CHANNEL,
  isStageKind,
  stageKeyAction,
  stageUrl,
  type StageContent,
  type StageItemInfo,
  type StageKeyInput,
  type StageKind,
  type StageState,
  type StageView
} from '@shared/stage'
import * as files from './files'
import type { Notifier } from './notifier'
import type { FileGuard } from './protected'
import { ValidationError } from './validate'

/** Displays other than the built-in one, when there is more than one display to project to. */
export function countExternalDisplays(screen: Pick<ScreenLike, 'getAllDisplays'>): number {
  const all = screen.getAllDisplays()
  return all.length > 1 ? all.filter((d) => !d.internal).length : 0
}

export interface DisplayLike {
  internal?: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}

/** The slice of Electron's `screen` this needs, so it can be tested with a fake. */
export interface ScreenLike {
  getAllDisplays(): DisplayLike[]
  getPrimaryDisplay?(): DisplayLike
  on(event: 'display-added', listener: (e: unknown, display: DisplayLike) => void): unknown
  removeListener(
    event: 'display-added',
    listener: (e: unknown, display: DisplayLike) => void
  ): unknown
}

/** The window the Stage shows in. It has no say in what it shows: main pushes every view. */
export interface StageWindowLike {
  showView(view: StageView): void
  close(): void
}

export interface StageDeps {
  screen: ScreenLike
  notifier: Notifier
  /** Closes the vault at once. Called before anything appears on the display. */
  lockVault: (reason: 'presenting' | 'display') => void
  /** Opens the Stage window on a display. The window calls `windowClosed` if it is closed. */
  openWindow: (display: DisplayLike | undefined) => StageWindowLike
  /** What a window outside the Vault may read: a protected file is refused. */
  guard: FileGuard
  offerEnabled: () => boolean
  /** Tells the Presenter about a change or an offer. */
  sendToLauncher: (channel: string, payload: unknown) => void
  /** Called whenever the Stage opens or closes, for example to tick the View menu item. */
  onActiveChange?: (on: boolean) => void
}

interface Item {
  path: string
  name: string
  kind: StageKind
}

const STAGEABLE_HINT =
  'can not be shown on the Stage. Open it in its own app, or convert it to PDF first.'

/**
 * The main-process side of presenting. The Stage is a separate window with no access to the Vault
 * or to anything but the files queued here. Starting it locks the Vault first, and the Vault
 * refuses to open until the Stage ends. While it runs, system notifications are held.
 */
export function createStageService(deps: StageDeps) {
  let active = false
  let queue: Item[] = []
  let index = -1
  let blanked = false
  let win: StageWindowLike | null = null

  const displays = (): DisplayLike[] => deps.screen.getAllDisplays()
  const externalDisplays = (): number => countExternalDisplays(deps.screen)

  const state = (): StageState => ({
    active,
    items: queue.map((i): StageItemInfo => ({ name: i.name, kind: i.kind })),
    index,
    blanked,
    externalDisplays: externalDisplays(),
    offerEnabled: deps.offerEnabled()
  })

  async function contentFor(item: Item, at: number): Promise<StageContent> {
    const base = { name: item.name, kind: item.kind }
    try {
      // The file may have become protected (or vanished) since it was queued.
      await deps.guard.assertReadable(item.path)
      const f = await files.assertFile(item.path)
      switch (item.kind) {
        case 'pdf':
        case 'image':
          return { ...base, url: stageUrl(at, f.mtimeMs) }
        case 'docx':
          return { ...base, html: (await files.docxHtml(item.path)).html }
        case 'text': {
          const t = await files.readText(item.path).catch(async () => {
            // Markdown and plain text are editable kinds; anything else readable as text still shows.
            const buf = await readFile(item.path)
            return { text: buf.subarray(0, files.MAX_TEXT_BYTES).toString('utf8') }
          })
          return { ...base, text: t.text }
        }
      }
    } catch {
      // Not the reason: an error message could carry a path to the projector.
      return { ...base, message: 'This file could not be shown.' }
    }
  }

  async function view(): Promise<StageView> {
    const item = index >= 0 ? queue[index] : undefined
    return {
      active,
      blanked,
      index,
      count: queue.length,
      content: active && item && !blanked ? await contentFor(item, index) : null
    }
  }

  let pushing: Promise<void> | null = null
  let dirty = false
  /**
   * Tells everyone who shows the state about a change. Changes that arrive while a view is still
   * being prepared (a held-down key, a large document) are folded into one more push, so the window
   * always ends on the latest state and never shows an older one after a newer one.
   */
  function publish(): void {
    deps.sendToLauncher(STAGE_STATE_CHANNEL, state())
    if (!win) return
    dirty = true
    if (pushing) return
    pushing = (async () => {
      try {
        while (dirty) {
          dirty = false
          const target: StageWindowLike | null = win
          if (!target) break
          const v = await view()
          if (win === target) target.showView(v)
        }
      } finally {
        pushing = null
      }
    })()
  }

  const clamp = (i: number): number =>
    queue.length === 0 ? -1 : Math.max(0, Math.min(i, queue.length - 1))

  const onAdded = (_e: unknown, display: DisplayLike): void => {
    if (display.internal) return
    // A display appeared: whatever the Vault shows could be on it. Close it before anything else.
    deps.lockVault('display')
    if (active || !deps.offerEnabled()) return
    deps.sendToLauncher(DISPLAY_OFFER_CHANNEL, { reason: 'connected' } satisfies DisplayOffer)
  }
  deps.screen.on('display-added', onAdded)

  const service = {
    state,
    view,
    isActive: (): boolean => active,
    externalDisplays,
    offerEnabled: (): boolean => deps.offerEnabled(),

    async add(paths: unknown): Promise<StageState> {
      if (!Array.isArray(paths)) throw new ValidationError('Choose some files to add')
      const added: Item[] = []
      for (const raw of paths) {
        const f = await files.assertFile(raw)
        const name = basename(f.path)
        const kind = kindOf(f.path)
        if (!isStageKind(kind)) throw new ValidationError(`${name} ${STAGEABLE_HINT}`)
        await deps.guard.assertReadable(f.path)
        added.push({ path: f.path, name, kind })
      }
      if (queue.length + added.length > MAX_STAGE_ITEMS)
        throw new ValidationError(`The Stage holds at most ${MAX_STAGE_ITEMS} files`)
      queue = [...queue, ...added]
      if (index < 0) index = clamp(0)
      publish()
      return state()
    },

    remove(at: unknown): StageState {
      if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at >= queue.length)
        throw new ValidationError('That file is not in the queue')
      queue = queue.filter((_, i) => i !== at)
      index = clamp(at < index ? index - 1 : index)
      publish()
      return state()
    },

    move(from: unknown, to: unknown): StageState {
      const ok = (n: unknown): n is number =>
        typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < queue.length
      if (!ok(from) || !ok(to)) throw new ValidationError('That file is not in the queue')
      const shown = queue[index]
      const next = [...queue]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      queue = next
      index = shown ? queue.indexOf(shown) : index
      publish()
      return state()
    },

    clear(): StageState {
      queue = []
      index = -1
      publish()
      return state()
    },

    goto(at: unknown): StageState {
      if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at >= queue.length)
        throw new ValidationError('That file is not in the queue')
      index = at
      blanked = false
      publish()
      return state()
    },

    next(): StageState {
      index = clamp(index + 1)
      blanked = false
      publish()
      return state()
    },

    previous(): StageState {
      index = clamp(index - 1)
      blanked = false
      publish()
      return state()
    },

    blank(on?: unknown): StageState {
      blanked = typeof on === 'boolean' ? on : !blanked
      publish()
      return state()
    },

    /** Closes the Vault, then opens the Stage on the other display, or this one if there is none. */
    start(): StageState {
      if (active) return state()
      // First, before a single pixel goes to the display.
      deps.lockVault('presenting')
      active = true
      blanked = false
      if (index < 0) index = clamp(0)
      try {
        // The other display if there is one, otherwise this screen (handy for a rehearsal).
        const other = displays().find((d) => !d.internal)
        win = deps.openWindow(externalDisplays() > 0 ? other : deps.screen.getPrimaryDisplay?.())
      } catch (err) {
        active = false
        win = null
        throw err
      }
      deps.notifier.setPresenting(true)
      deps.onActiveChange?.(true)
      publish()
      return state()
    },

    end(): StageState {
      if (!active) return state()
      const closing = win
      active = false
      blanked = false
      win = null
      closing?.close()
      deps.notifier.setPresenting(false)
      deps.onActiveChange?.(false)
      publish()
      return state()
    },

    /** The window went away by itself (closed, crashed): the presentation is over. */
    windowClosed(): void {
      if (!active) return
      win = null
      service.end()
    },

    toggle(): StageState {
      return active ? service.end() : service.start()
    },

    /** Handles a key pressed on the Stage. True if it was one of ours. */
    handleKey(input: StageKeyInput): boolean {
      if (!active) return false
      const kind = index >= 0 ? (queue[index]?.kind ?? null) : null
      switch (stageKeyAction(input, kind)) {
        case 'end':
          service.end()
          return true
        case 'next':
          service.next()
          return true
        case 'previous':
          service.previous()
          return true
        case 'blank':
          service.blank()
          return true
        default:
          return false
      }
    },

    /**
     * Resolves `tos-file://stage/<index>` to a file to serve. Only the queued PDFs and images of a
     * running Stage, and only while they are not in a protected folder.
     */
    async resolveServed(url: string): Promise<string> {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new ValidationError('Bad file URL')
      }
      const at = /^\/(\d{1,4})$/.exec(parsed.pathname)
      if (!active || parsed.host !== STAGE_HOST || !at) throw new ValidationError('Bad file URL')
      const item = queue[Number(at[1])]
      if (!item || (item.kind !== 'pdf' && item.kind !== 'image'))
        throw new ValidationError('That file is not on the Stage')
      return files.resolveServedPath(toFileUrl(item.path), (p) => deps.guard.assertReadable(p))
    },

    /** Waits for views already pushed to the window. For tests. */
    settled: async (): Promise<void> => {
      while (pushing) await pushing
    },

    dispose(): void {
      deps.screen.removeListener('display-added', onAdded)
    }
  }
  return service
}

export type StageService = ReturnType<typeof createStageService>
