import { Document, Packer, Paragraph, TextRun } from 'docx'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DISPLAY_OFFER_CHANNEL } from '@shared/events'
import { STAGE_STATE_CHANNEL, type StageView } from '@shared/stage'
import { createNotifier, type Notice } from '../../src/main/notifier'
import { PROTECTED_MESSAGE, createFileGuard, createProtectedPaths } from '../../src/main/protected'
import {
  countExternalDisplays,
  createStageService,
  type DisplayLike,
  type ScreenLike,
  type StageWindowLike
} from '../../src/main/stage'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

class FakeScreen extends EventEmitter {
  displays: DisplayLike[]
  constructor(
    displays: DisplayLike[] = [{ internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 } }]
  ) {
    super()
    this.displays = displays
  }
  getAllDisplays() {
    return this.displays
  }
  getPrimaryDisplay() {
    return this.displays[0]
  }
}
const EXTERNAL: DisplayLike = {
  internal: false,
  bounds: { x: 1440, y: 0, width: 1920, height: 1080 }
}

const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'

function setup(
  over: { screen?: FakeScreen; offerEnabled?: boolean; protectedFolders?: string[] } = {}
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tos-stage-')))
  dirs.push(root)
  mkdirSync(join(root, 'Exams'))
  const f = (name: string, content: string | Buffer = 'x'): string => {
    const p = join(root, name)
    writeFileSync(p, content)
    return p
  }
  const files = {
    pdf: f('Slides.pdf', PDF),
    png: f('Diagram.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    txt: f('Notes.txt', 'Do now: list three causes.'),
    md: f('Warmup.md', '# Warm-up'),
    xlsx: f('Grades.xlsx'),
    pptx: f('Deck.pptx'),
    exam: f('Exams/Final.pdf', PDF)
  }
  const screen = over.screen ?? new FakeScreen()
  const log: string[] = []
  const windows: { display: DisplayLike | undefined; views: StageView[]; closed: boolean }[] = []
  const sent: { channel: string; payload: unknown }[] = []
  const shown: Notice[] = []
  let closeHook: (() => void) | null = null
  const notifier = createNotifier({ show: (n) => shown.push(n) })
  const changes: boolean[] = []
  let offerEnabled = over.offerEnabled ?? true
  const svc = createStageService({
    screen: screen as unknown as ScreenLike,
    notifier,
    lockVault: (reason) => log.push(`lock:${reason}`),
    guard: createFileGuard({
      paths: createProtectedPaths({
        folders: () => over.protectedFolders ?? [join(root, 'Exams')],
        foldCase: false
      }),
      allowProtected: () => false,
      externalDisplays: () => 0
    }),
    offerEnabled: () => offerEnabled,
    sendToLauncher: (channel, payload) => sent.push({ channel, payload }),
    onActiveChange: (on) => changes.push(on),
    openWindow: (display) => {
      log.push('open')
      const w = { display, views: [] as StageView[], closed: false }
      windows.push(w)
      closeHook = () => svc.windowClosed()
      const win: StageWindowLike = {
        showView: (v) => w.views.push(v),
        close: () => {
          w.closed = true
        }
      }
      return win
    }
  })
  return {
    svc,
    root,
    files,
    screen,
    log,
    windows,
    sent,
    shown,
    notifier,
    changes,
    setOffer: (on: boolean) => (offerEnabled = on),
    userClosesWindow: () => closeHook?.()
  }
}

describe('starting and ending the stage', () => {
  it('locks the vault before the stage window opens', async () => {
    const t = setup()
    t.svc.start()
    expect(t.log).toEqual(['lock:presenting', 'open'])
    expect(t.svc.isActive()).toBe(true)
  })

  it('opens on the other display when there is one, otherwise on this screen', () => {
    const a = setup({
      screen: new FakeScreen([
        { internal: true, bounds: { x: 0, y: 0, width: 1, height: 1 } },
        EXTERNAL
      ])
    })
    a.svc.start()
    expect(a.windows[0].display).toBe(EXTERNAL)
    const b = setup()
    b.svc.start()
    expect(b.windows[0].display).toEqual({
      internal: true,
      bounds: { x: 0, y: 0, width: 1440, height: 900 }
    })
  })

  it('is idempotent: starting twice opens one window and locks once', () => {
    const t = setup()
    t.svc.start()
    t.svc.start()
    expect(t.windows).toHaveLength(1)
    expect(t.log.filter((l) => l.startsWith('lock'))).toHaveLength(1)
    expect(t.changes).toEqual([true])
  })

  it('holds system notifications while showing and releases them as one summary after', () => {
    const t = setup()
    t.svc.start()
    t.notifier.notify({ title: 'Backup failed', body: 'x' })
    t.notifier.notify({ title: 'Other', body: 'y' })
    expect(t.shown).toEqual([])
    t.svc.end()
    expect(t.shown).toHaveLength(1)
    expect(t.shown[0].title).toMatch(/2 notifications while you were presenting/)
    expect(t.changes).toEqual([true, false])
  })

  it('ending closes the window, and ending twice is harmless', () => {
    const t = setup()
    t.svc.start()
    t.svc.end()
    t.svc.end()
    expect(t.windows[0].closed).toBe(true)
    expect(t.svc.isActive()).toBe(false)
    expect(t.changes).toEqual([true, false])
  })

  it('a stage window closed by anything else ends the presentation', () => {
    const t = setup()
    t.svc.start()
    t.userClosesWindow()
    expect(t.svc.isActive()).toBe(false)
    expect(t.changes).toEqual([true, false])
    expect(t.windows[0].closed).toBe(false) // it is already gone; nothing to close again
  })

  it('does not stay active if the window cannot be opened', () => {
    const t = setup()
    const failing = createStageService({
      screen: t.screen as unknown as ScreenLike,
      notifier: t.notifier,
      lockVault: () => undefined,
      guard: createFileGuard({
        paths: createProtectedPaths({ folders: () => [] }),
        allowProtected: () => false,
        externalDisplays: () => 0
      }),
      offerEnabled: () => true,
      sendToLauncher: () => undefined,
      openWindow: () => {
        throw new Error('no window')
      }
    })
    expect(() => failing.start()).toThrow('no window')
    expect(failing.isActive()).toBe(false)
    expect(t.notifier.isPresenting()).toBe(false)
  })

  it('toggle starts and ends', () => {
    const t = setup()
    expect(t.svc.toggle().active).toBe(true)
    expect(t.svc.toggle().active).toBe(false)
  })

  it('tells the presenter about every change', async () => {
    const t = setup()
    t.svc.start()
    t.svc.end()
    const states = t.sent
      .filter((s) => s.channel === STAGE_STATE_CHANNEL)
      .map((s) => (s.payload as { active: boolean }).active)
    expect(states).toEqual([true, false])
  })
})

describe('the queue', () => {
  it('accepts PDFs, images, text and markdown, and reports names and kinds without paths', async () => {
    const t = setup()
    const s = await t.svc.add([t.files.pdf, t.files.png, t.files.txt, t.files.md])
    expect(s.items).toEqual([
      { name: 'Slides.pdf', kind: 'pdf' },
      { name: 'Diagram.png', kind: 'image' },
      { name: 'Notes.txt', kind: 'text' },
      { name: 'Warmup.md', kind: 'text' }
    ])
    expect(JSON.stringify(s)).not.toContain(t.root)
    expect(s.index).toBe(0)
  })

  it('refuses what the stage cannot show, and says what to do instead', async () => {
    const t = setup()
    await expect(t.svc.add([t.files.xlsx])).rejects.toThrow(/Grades.xlsx .*own app/)
    await expect(t.svc.add([t.files.pptx])).rejects.toThrow(/Deck.pptx .*own app/)
    expect(t.svc.state().items).toEqual([])
  })

  it('refuses protected files, including through a symlink, and adds nothing from a mixed batch', async () => {
    const t = setup()
    await expect(t.svc.add([t.files.exam])).rejects.toThrow(PROTECTED_MESSAGE)
    const link = join(t.root, 'innocent.pdf')
    symlinkSync(t.files.exam, link)
    await expect(t.svc.add([link])).rejects.toThrow(PROTECTED_MESSAGE)
    await expect(t.svc.add([t.files.pdf, t.files.exam])).rejects.toThrow(PROTECTED_MESSAGE)
    expect(t.svc.state().items).toEqual([])
  })

  it('validates paths and input', async () => {
    const t = setup()
    await expect(t.svc.add('nope' as never)).rejects.toThrow(/Choose some files/)
    await expect(t.svc.add(['relative.pdf'])).rejects.toThrow(/not a valid file path/)
    await expect(t.svc.add([join(t.root, 'missing.pdf')])).rejects.toThrow(/no longer exists/)
    await expect(t.svc.add([42 as never])).rejects.toThrow(/not a valid file path/)
    await expect(t.svc.add([t.root])).rejects.toThrow(/not a file/)
  })

  it('caps the queue', async () => {
    const t = setup()
    await t.svc.add(Array.from({ length: 100 }, () => t.files.pdf))
    await expect(t.svc.add([t.files.pdf])).rejects.toThrow(/at most 100/)
    expect(t.svc.state().items).toHaveLength(100)
  })

  it('moves, removes and clears while keeping the same file on the stage', async () => {
    const t = setup()
    await t.svc.add([t.files.pdf, t.files.png, t.files.txt])
    t.svc.goto(1) // Diagram
    expect(t.svc.move(0, 2).items.map((i) => i.name)).toEqual([
      'Diagram.png',
      'Notes.txt',
      'Slides.pdf'
    ])
    expect(t.svc.state().index).toBe(0) // still Diagram
    t.svc.goto(2)
    expect(t.svc.remove(0).index).toBe(1) // Slides moved up; still Slides
    expect(t.svc.state().items[1].name).toBe('Slides.pdf')
    expect(t.svc.remove(1).index).toBe(0)
    expect(t.svc.clear()).toMatchObject({ items: [], index: -1 })
    expect(() => t.svc.remove(0)).toThrow(/not in the queue/)
    expect(() => t.svc.move(0, 0)).toThrow(/not in the queue/)
    expect(() => t.svc.goto(-1)).toThrow(/not in the queue/)
    expect(() => t.svc.goto(1.5 as never)).toThrow(/not in the queue/)
  })

  it('moves between files without running off either end, and un-blanks', async () => {
    const t = setup()
    await t.svc.add([t.files.pdf, t.files.png])
    t.svc.blank(true)
    expect(t.svc.next()).toMatchObject({ index: 1, blanked: false })
    expect(t.svc.next().index).toBe(1)
    expect(t.svc.previous().index).toBe(0)
    expect(t.svc.previous().index).toBe(0)
    expect(t.svc.blank().blanked).toBe(true)
    expect(t.svc.blank().blanked).toBe(false)
    expect(t.svc.blank(true).blanked).toBe(true)
    expect(t.svc.blank(true).blanked).toBe(true)
  })

  it('keeps the queue after the stage ends, so it can be started again', async () => {
    const t = setup()
    await t.svc.add([t.files.pdf])
    t.svc.start()
    t.svc.end()
    expect(t.svc.state().items).toHaveLength(1)
  })
})

describe('what the stage shows', () => {
  it('shows nothing until the stage is running, and nothing while blanked', async () => {
    const t = setup()
    await t.svc.add([t.files.txt])
    expect((await t.svc.view()).content).toBeNull()
    t.svc.start()
    expect((await t.svc.view()).content).toMatchObject({
      kind: 'text',
      text: 'Do now: list three causes.'
    })
    t.svc.blank(true)
    expect(await t.svc.view()).toMatchObject({ active: true, blanked: true, content: null })
  })

  it('serves PDFs and images by index, with no path in what the stage receives', async () => {
    const t = setup()
    await t.svc.add([t.files.pdf, t.files.png])
    t.svc.start()
    const a = await t.svc.view()
    expect(a.content?.url).toMatch(/^tos-file:\/\/stage\/0\?v=\d+$/)
    t.svc.next()
    expect((await t.svc.view()).content?.url).toMatch(/^tos-file:\/\/stage\/1\?v=\d+$/)
    expect(JSON.stringify(await t.svc.view())).not.toContain(t.root)
  })

  it('converts a Word document to HTML', async () => {
    const t = setup()
    const docx = join(t.root, 'Handout.docx')
    writeFileSync(
      docx,
      await Packer.toBuffer(
        new Document({
          sections: [
            { children: [new Paragraph({ children: [new TextRun('Causes of the war')] })] }
          ]
        })
      )
    )
    await t.svc.add([docx])
    t.svc.start()
    expect((await t.svc.view()).content?.html).toContain('Causes of the war')
  })

  it('shows a plain message, never a path or an error, when a file cannot be read', async () => {
    const t = setup()
    await t.svc.add([t.files.txt])
    t.svc.start()
    rmSync(t.files.txt)
    const v = await t.svc.view()
    expect(v.content).toEqual({
      name: 'Notes.txt',
      kind: 'text',
      message: 'This file could not be shown.'
    })
    expect(JSON.stringify(v)).not.toContain(t.root)
  })

  it('refuses at show time a file that became protected after it was queued', async () => {
    let folders: string[] = []
    const t = setup({ protectedFolders: folders })
    // The guard reads the list on every call, so protecting the folder later takes effect at once.
    const svc = createStageService({
      screen: new FakeScreen() as unknown as ScreenLike,
      notifier: createNotifier({ show: () => undefined }),
      lockVault: () => undefined,
      guard: createFileGuard({
        paths: createProtectedPaths({ folders: () => folders, foldCase: false }),
        allowProtected: () => false,
        externalDisplays: () => 0
      }),
      offerEnabled: () => true,
      sendToLauncher: () => undefined,
      openWindow: () => ({ showView: () => undefined, close: () => undefined })
    })
    await svc.add([t.files.txt])
    svc.start()
    expect((await svc.view()).content?.text).toContain('Do now')
    folders = [t.root]
    expect((await svc.view()).content).toMatchObject({ message: 'This file could not be shown.' })
  })

  it('always ends on the latest state, and never shows an older one after a newer one', async () => {
    const t = setup()
    await t.svc.add([t.files.txt, t.files.md])
    t.svc.start()
    t.svc.next()
    t.svc.blank(true)
    await t.svc.settled()
    const views = t.windows[0].views
    expect(views.length).toBeGreaterThan(0)
    expect(views.length).toBeLessThanOrEqual(3)
    expect(views.at(-1)).toMatchObject({ index: 1, blanked: true, content: null })
    const indexes = views.map((v) => v.index)
    expect([...indexes].sort()).toEqual(indexes)
    t.svc.blank(false)
    await t.svc.settled()
    expect(t.windows[0].views.at(-1)?.content?.name).toBe('Warmup.md')
  })

  it('does not push to a window that has gone', async () => {
    const t = setup()
    await t.svc.add([t.files.txt])
    t.svc.start()
    t.svc.end()
    await t.svc.settled()
    const before = t.windows[0].views.length
    t.svc.next()
    await t.svc.settled()
    expect(t.windows[0].views).toHaveLength(before)
  })
})

describe('display events', () => {
  it('locks the vault the moment an external display is added, and offers the stage', () => {
    const t = setup()
    t.screen.emit('display-added', {}, { internal: false })
    expect(t.log).toEqual(['lock:display'])
    expect(t.sent).toEqual([{ channel: DISPLAY_OFFER_CHANNEL, payload: { reason: 'connected' } }])
  })

  it('locks but does not offer when the stage is already showing, or the setting is off', () => {
    const a = setup()
    a.svc.start()
    a.log.length = 0
    a.sent.length = 0
    a.screen.emit('display-added', {}, { internal: false })
    expect(a.log).toEqual(['lock:display'])
    expect(a.sent.filter((s) => s.channel === DISPLAY_OFFER_CHANNEL)).toEqual([])

    const b = setup({ offerEnabled: false })
    b.screen.emit('display-added', {}, { internal: false })
    expect(b.log).toEqual(['lock:display'])
    expect(b.sent).toEqual([])
  })

  it('ignores the built-in display', () => {
    const t = setup()
    t.screen.emit('display-added', {}, { internal: true })
    expect(t.log).toEqual([])
    expect(t.sent).toEqual([])
  })

  it('reads the offer setting each time', () => {
    const t = setup({ offerEnabled: false })
    t.screen.emit('display-added', {}, { internal: false })
    t.setOffer(true)
    t.screen.emit('display-added', {}, { internal: false })
    expect(t.sent).toHaveLength(1)
  })

  it('stops listening when disposed', () => {
    const t = setup()
    t.svc.dispose()
    t.screen.emit('display-added', {}, { internal: false })
    expect(t.log).toEqual([])
    expect(t.screen.listenerCount('display-added')).toBe(0)
  })

  it('counts external displays only when more than one display is present', () => {
    expect(countExternalDisplays(new FakeScreen([{ internal: true }]))).toBe(0)
    expect(countExternalDisplays(new FakeScreen([{ internal: true }, { internal: false }]))).toBe(1)
    // A lone external monitor (desktop Mac) is the only display, so there is nothing to project to.
    expect(countExternalDisplays(new FakeScreen([{ internal: false }]))).toBe(0)
  })
})

describe('stage keys', () => {
  it('are ignored unless the stage is showing', async () => {
    const t = setup()
    await t.svc.add([t.files.png, t.files.txt])
    expect(t.svc.handleKey({ key: 'Escape' })).toBe(false)
    expect(t.svc.handleKey({ key: ']' })).toBe(false)
  })

  it('move, blank and end the stage', async () => {
    const t = setup()
    await t.svc.add([t.files.png, t.files.txt])
    t.svc.start()
    expect(t.svc.handleKey({ key: 'ArrowRight' })).toBe(true)
    expect(t.svc.state().index).toBe(1)
    expect(t.svc.handleKey({ key: 'b' })).toBe(true)
    expect(t.svc.state().blanked).toBe(true)
    expect(t.svc.handleKey({ key: 'a' })).toBe(false)
    expect(t.svc.handleKey({ key: 'Escape' })).toBe(true)
    expect(t.svc.isActive()).toBe(false)
  })

  it('leave the arrows to a PDF, which pages through itself', async () => {
    const t = setup()
    await t.svc.add([t.files.pdf, t.files.png])
    t.svc.start()
    expect(t.svc.handleKey({ key: 'ArrowRight' })).toBe(false)
    expect(t.svc.state().index).toBe(0)
    expect(t.svc.handleKey({ key: ']' })).toBe(true)
    expect(t.svc.state().index).toBe(1)
  })
})

describe('serving files to the stage', () => {
  const url = (path: string): string => `tos-file://stage${path}`

  it('serves only queued PDFs and images, only while the stage is showing', async () => {
    const t = setup()
    await t.svc.add([t.files.pdf, t.files.png, t.files.txt])
    await expect(t.svc.resolveServed(url('/0'))).rejects.toThrow(/Bad file URL/) // not showing yet
    t.svc.start()
    expect(await t.svc.resolveServed(url('/0?v=1'))).toBe(t.files.pdf)
    expect(await t.svc.resolveServed(url('/1'))).toBe(t.files.png)
    await expect(t.svc.resolveServed(url('/2'))).rejects.toThrow(/not on the Stage/) // text is sent inline
    await expect(t.svc.resolveServed(url('/3'))).rejects.toThrow(/not on the Stage/)
    t.svc.end()
    await expect(t.svc.resolveServed(url('/0'))).rejects.toThrow(/Bad file URL/)
  })

  it('refuses anything that is not a plain queue index on the stage host', async () => {
    const t = setup()
    await t.svc.add([t.files.pdf])
    t.svc.start()
    for (const bad of [
      'tos-file://local/' + encodeURIComponent(t.files.pdf),
      `tos-file://local${t.files.pdf}`,
      url('/'),
      url('/abc'),
      url('/-1'),
      url('/0/../1'),
      url('/00000'),
      url('//etc/passwd'),
      `tos-file://stage.evil/0`,
      'not a url'
    ]) {
      await expect(t.svc.resolveServed(bad), bad).rejects.toThrow()
    }
  })

  it('refuses a queued file that has become protected', async () => {
    const folders: string[] = []
    const t = setup({ protectedFolders: folders })
    await t.svc.add([t.files.pdf])
    t.svc.start()
    expect(await t.svc.resolveServed(url('/0'))).toBe(t.files.pdf)
    folders.push(t.root)
    await expect(t.svc.resolveServed(url('/0'))).rejects.toThrow(PROTECTED_MESSAGE)
  })
})

describe('In-class Tools on the stage', () => {
  const groups = [
    ['Ada', 'Ben'],
    ['Cy', 'Di']
  ]
  const running = (msLeft: number) => ({
    status: 'running' as const,
    durationMs: 300_000,
    remainingMs: 300_000,
    endsAt: Date.now() + msLeft
  })

  it('refuses until the stage is showing, so names never wait in main for a later start', async () => {
    const t = setup()
    expect(() => t.svc.showTool({ kind: 'picker', name: 'Ada' })).toThrow(/Start the Stage/)
    expect(() => t.svc.setTimer(running(60_000))).toThrow(/Start the Stage/)
    expect(t.svc.state()).toMatchObject({ tool: null, timer: false })
  })

  it('shows a tool full screen in place of the file, and tells the presenter which', async () => {
    const t = setup()
    await t.svc.add([t.files.txt])
    t.svc.start()
    t.svc.showTool({ kind: 'groups', groups })
    const v = await t.svc.view()
    expect(v.content).toBeNull()
    expect(v.tool).toEqual({ kind: 'groups', groups })
    expect(t.svc.state()).toMatchObject({ tool: 'groups', timer: false })
    t.svc.showTool(null)
    expect((await t.svc.view()).content).toMatchObject({ kind: 'text' })
  })

  it('floats the timer over the file, and keeps it while moving between files', async () => {
    const t = setup()
    await t.svc.add([t.files.txt, t.files.md])
    t.svc.start()
    const timer = running(60_000)
    t.svc.setTimer(timer)
    t.svc.next()
    const v = await t.svc.view()
    expect(v.content).toMatchObject({ name: 'Warmup.md' })
    expect(v.timer).toEqual(timer)
    expect(t.svc.state().timer).toBe(true)
    t.svc.setTimer(null)
    expect((await t.svc.view()).timer).toBeNull()
  })

  it('moving to a file puts the tool away', async () => {
    const t = setup()
    await t.svc.add([t.files.txt, t.files.md])
    t.svc.start()
    for (const move of [() => t.svc.next(), () => t.svc.previous(), () => t.svc.goto(1)]) {
      t.svc.showTool({ kind: 'picker', name: 'Ada' })
      move()
      expect(t.svc.state().tool).toBeNull()
    }
  })

  it('Escape puts the tool away first, then ends the stage', async () => {
    const t = setup()
    t.svc.start()
    t.svc.showTool({ kind: 'picker', name: 'Ada' })
    expect(t.svc.handleKey({ key: 'Escape' })).toBe(true)
    expect(t.svc.isActive()).toBe(true)
    expect(t.svc.state().tool).toBeNull()
    t.svc.handleKey({ key: 'Escape' })
    expect(t.svc.isActive()).toBe(false)
  })

  it('Escape ends a blanked stage straight away, even with a tool up behind the blank', () => {
    const t = setup()
    t.svc.start()
    t.svc.showTool({ kind: 'picker', name: 'Ada' })
    t.svc.blank(true)
    t.svc.handleKey({ key: 'Escape' })
    expect(t.svc.isActive()).toBe(false)
  })

  it('blanking hides the tool and the timer too', async () => {
    const t = setup()
    t.svc.start()
    t.svc.showTool({ kind: 'picker', name: 'Ada' })
    t.svc.setTimer(running(60_000))
    t.svc.blank(true)
    expect(await t.svc.view()).toMatchObject({ content: null, tool: null, timer: null })
    t.svc.blank(false)
    expect((await t.svc.view()).tool).toEqual({ kind: 'picker', name: 'Ada' })
  })

  it('forgets the names and the timer when the stage ends', async () => {
    const t = setup()
    t.svc.start()
    t.svc.showTool({ kind: 'groups', groups })
    t.svc.setTimer(running(60_000))
    t.svc.end()
    t.svc.start()
    expect(await t.svc.view()).toMatchObject({ tool: null, timer: null })
  })

  it('checks what it is sent', () => {
    const t = setup()
    t.svc.start()
    const bad: unknown[] = [
      { kind: 'picker', name: '' },
      { kind: 'picker', name: 'x'.repeat(81) },
      { kind: 'picker', name: 42 },
      { kind: 'groups', groups: [] },
      { kind: 'groups', groups: [[]] },
      { kind: 'groups', groups: [['Ada', { toString: () => 'x' }]] },
      { kind: 'groups', groups: [Array.from({ length: 201 }, (_, i) => `N${i}`)] },
      { kind: 'seating' },
      'Ada'
    ]
    for (const b of bad) expect(() => t.svc.showTool(b as never), JSON.stringify(b)).toThrow()
    const badTimers: unknown[] = [
      { ...running(1000), status: 'exploding' },
      { ...running(1000), endsAt: null },
      { ...running(1000), endsAt: Date.now() + 2 * 24 * 3_600_000 },
      { ...running(1000), durationMs: -1 },
      { ...running(1000), remainingMs: Number.NaN }
    ]
    for (const b of badTimers) expect(() => t.svc.setTimer(b as never), JSON.stringify(b)).toThrow()
    expect(t.svc.state()).toMatchObject({ tool: null, timer: false })
    // A paused timer carries no end time, whatever was sent.
    t.svc.setTimer({ status: 'paused', durationMs: 60_000, remainingMs: 30_000, endsAt: 5 })
    expect(t.svc.state().timer).toBe(true)
  })
})
