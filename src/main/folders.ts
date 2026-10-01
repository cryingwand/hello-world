import type { FSWatcher } from 'node:fs'
import { mkdir, readdir, realpath, rename, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { FolderEntry, FolderListing, FolderPlace } from '@shared/files'
import { kindOf } from '@shared/files'
import type { FileGuard } from './protected'
import { PROTECTED_MESSAGE } from './protected'
import { ValidationError } from './validate'

/** Most entries one listing returns. */
export const MAX_ENTRIES = 2000
/** Folders watched for changes made elsewhere (Finder, Word saving), most recently listed first. */
const MAX_WATCHED = 16
/** Most files one move or trash may take. */
const MAX_BATCH = 500

export interface FoldersDeps {
  home: string
  teachingFolders: () => readonly string[]
  guard: FileGuard
  /** Moves a file or folder to the Trash (Electron's `shell.trashItem`). Never deletes. */
  trash: (path: string) => Promise<void>
  /** Called after a change made here, and when a watched folder changes on disk. */
  changed: () => void
  /** A file or folder was renamed or moved here, so anything pointing at it can follow. */
  moved?: (from: string, to: string) => void
  /** `fs.watch`; left out where nothing should be watched (tests). */
  watch?: (dir: string, onChange: () => void) => FSWatcher | { close(): void }
}

const SKIP = new Set(['Icon\r', '$RECYCLE.BIN'])

/** Folders that are part of how the Mac is set up: browsing them is fine, moving them is not. */
const FIXED = [
  'Desktop',
  'Documents',
  'Downloads',
  'Library',
  'Movies',
  'Music',
  'Pictures',
  'Public',
  'Applications'
]

const isDir = (path: string): Promise<boolean> =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false
  )

function absolute(path: unknown, what = 'That'): string {
  if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) {
    throw new ValidationError(`${what} is not a valid location`)
  }
  return resolve(path)
}

/** A name for a new or renamed file: one path segment, not hidden, no slashes. */
export function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new ValidationError('A name is required')
  const n = name.trim()
  if (n === '') throw new ValidationError('A name is required')
  if (n.length > 255) throw new ValidationError('That name is too long')
  if (n.includes('/') || n.includes(':') || n.includes('\0')) {
    throw new ValidationError('A name cannot contain / or :')
  }
  if (n.startsWith('.')) throw new ValidationError('A name cannot start with a dot')
  return n
}

/**
 * The Mac's own files, as a folder browser sees them. Anything may be listed (protected files are left
 * out outside the Vault, as in search), but changes are only made inside the home folder, never to a
 * protected file or folder or one that holds one, never to the fixed folders (Desktop, Documents…),
 * never over an existing file, and a delete is always a move to the Trash.
 */
export function createFolders(deps: FoldersDeps) {
  const home = resolve(deps.home)
  const watchers = new Map<string, { close(): void }>()

  /** Keeps an eye on a folder someone is looking at, so a change made in Finder shows up. */
  const watch = (dir: string): void => {
    if (!deps.watch) return
    const had = watchers.get(dir)
    if (had) {
      // Most recent last, so the oldest is the one dropped.
      watchers.delete(dir)
      watchers.set(dir, had)
      return
    }
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const w = deps.watch(dir, () => {
        clearTimeout(timer)
        timer = setTimeout(deps.changed, 300)
      })
      watchers.set(dir, w)
    } catch {
      return // A folder that cannot be watched still lists; it just refreshes when asked.
    }
    while (watchers.size > MAX_WATCHED) {
      const [oldest, w] = watchers.entries().next().value as [string, { close(): void }]
      w.close()
      watchers.delete(oldest)
    }
  }

  const realHome = (): Promise<string> => realpath(home).catch(() => home)

  /** Inside the home folder, where it really is (a link out of it does not count). */
  const inHome = async (path: string): Promise<boolean> => {
    const root = await realHome()
    const real = await realpath(path).catch(() => null)
    if (!real) return false
    return real.startsWith(root + sep) && !real.startsWith(join(root, 'Library') + sep)
  }

  /** Throws unless this file or folder may be renamed, moved or trashed. */
  const assertChangeable = async (path: string): Promise<void> => {
    const st = await stat(path).catch(() => null)
    if (!st) throw new ValidationError(`“${basename(path)}” is no longer there`)
    if (!(await inHome(path))) {
      throw new ValidationError('Only files inside your home folder can be changed here')
    }
    if (dirname(path) === home && FIXED.includes(basename(path))) {
      throw new ValidationError(`Your ${basename(path)} folder stays where it is`)
    }
    const snap = await deps.guard.snapshot()
    if (await snap.has(path)) throw new ValidationError(PROTECTED_MESSAGE)
    if (st.isDirectory() && (await snap.encloses(path))) {
      throw new ValidationError(
        'That folder holds a protected folder, so it stays where it is. Change it in Finder after removing the protection.'
      )
    }
  }

  /** Throws unless new files may be put in this folder. */
  const assertTarget = async (dir: string): Promise<void> => {
    if (!(await isDir(dir))) throw new ValidationError('That folder is no longer there')
    const root = await realHome()
    const real = await realpath(dir).catch(() => dir)
    if (real !== root && !(await inHome(dir))) {
      throw new ValidationError('Files can only be put in folders inside your home folder')
    }
    if (await deps.guard.isProtected(dir)) throw new ValidationError(PROTECTED_MESSAGE)
  }

  const free = async (path: string): Promise<void> => {
    if (
      await stat(path).then(
        () => true,
        () => false
      )
    ) {
      throw new ValidationError(`There is already something called “${basename(path)}” there`)
    }
  }

  const done = <T>(value: T): T => {
    deps.changed()
    return value
  }

  return {
    /** The sidebar: home, Desktop, Documents, Downloads, iCloud Drive, then the teaching folders. */
    async places(): Promise<FolderPlace[]> {
      const candidates: FolderPlace[] = [
        { path: home, name: 'Home', kind: 'home' },
        { path: join(home, 'Desktop'), name: 'Desktop', kind: 'desktop' },
        { path: join(home, 'Documents'), name: 'Documents', kind: 'documents' },
        { path: join(home, 'Downloads'), name: 'Downloads', kind: 'downloads' },
        {
          path: join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
          name: 'iCloud Drive',
          kind: 'icloud'
        },
        ...deps
          .teachingFolders()
          .map((p): FolderPlace => ({ path: resolve(p), name: basename(p), kind: 'teaching' }))
      ]
      const snap = await deps.guard.snapshot()
      const out: FolderPlace[] = []
      for (const p of candidates) {
        if (!(await isDir(p.path))) continue
        if (!deps.guard.allowProtected() && (await snap.has(p.path))) continue
        if (!out.some((o) => o.path === p.path)) out.push(p)
      }
      return out
    },

    async list(rawDir: string): Promise<FolderListing> {
      const dir = absolute(rawDir, 'That folder')
      if (!(await isDir(dir))) throw new ValidationError('That folder is no longer there')
      await deps.guard.assertReadable(dir)
      const snap = await deps.guard.snapshot()
      const hide = !deps.guard.allowProtected()
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        throw new ValidationError('That folder cannot be opened (macOS may need to give access)')
      }
      const visible = names.filter((n) => !n.startsWith('.') && !SKIP.has(n))
      const entries: FolderEntry[] = []
      for (const name of visible.slice(0, MAX_ENTRIES)) {
        const path = join(dir, name)
        const st = await stat(path).catch(() => null)
        if (!st || (!st.isFile() && !st.isDirectory())) continue
        // Outside the Vault a protected file is as good as not there.
        if (hide && (await snap.has(path))) continue
        entries.push({
          path,
          name,
          isDir: st.isDirectory(),
          kind: st.isDirectory() ? 'other' : kindOf(path),
          size: st.isDirectory() ? 0 : st.size,
          mtime: st.mtimeMs
        })
      }
      entries.sort(
        (a, b) =>
          Number(b.isDir) - Number(a.isDir) ||
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      )
      watch(dir)
      const parent = dirname(dir)
      const root = await realHome()
      const real = await realpath(dir).catch(() => dir)
      return {
        path: dir,
        name: dir === home ? 'Home' : basename(dir) || dir,
        parent: parent === dir ? null : parent,
        entries,
        truncated: visible.length > MAX_ENTRIES,
        writable: (real === root || (await inHome(dir))) && !(await snap.has(dir))
      }
    },

    async createFolder(rawDir: string, rawName: string): Promise<string> {
      const dir = absolute(rawDir, 'That folder')
      const name = cleanName(rawName)
      await assertTarget(dir)
      const path = join(dir, name)
      await free(path)
      await mkdir(path)
      return done(path)
    },

    async rename(rawPath: string, rawName: string): Promise<string> {
      const path = absolute(rawPath)
      const name = cleanName(rawName)
      if (name === basename(path)) return path
      await assertChangeable(path)
      const next = join(dirname(path), name)
      // A change of case only is the same file on a Mac's disk, so it does not count as taken.
      if (next.toLowerCase() !== path.toLowerCase()) await free(next)
      await rename(path, next)
      deps.moved?.(path, next)
      return done(next)
    },

    /** Moves each into a folder. All are checked before any moves, so a refusal changes nothing. */
    async move(rawPaths: string[], rawDir: string): Promise<string[]> {
      if (!Array.isArray(rawPaths) || rawPaths.length === 0 || rawPaths.length > MAX_BATCH) {
        throw new ValidationError('Choose what to move')
      }
      const paths = [...new Set(rawPaths.map((p) => absolute(p)))]
      const dir = absolute(rawDir, 'That folder')
      await assertTarget(dir)
      const moves: [string, string][] = []
      for (const path of paths) {
        if (dirname(path) === dir) continue
        if (dir === path || dir.startsWith(path + sep)) {
          throw new ValidationError(`“${basename(path)}” cannot go inside itself`)
        }
        await assertChangeable(path)
        const target = join(dir, basename(path))
        await free(target)
        moves.push([path, target])
      }
      for (const [from, to] of moves) {
        try {
          await rename(from, to)
        } catch (err) {
          if ((err as { code?: string }).code === 'EXDEV') {
            throw new ValidationError('Moving to another disk is done in Finder')
          }
          throw err
        }
        deps.moved?.(from, to)
      }
      return moves.length > 0 ? done(moves.map(([, to]) => to)) : []
    },

    /** To the Trash, where it can be put back from. Nothing is ever deleted outright. */
    async trash(rawPaths: string[]): Promise<void> {
      if (!Array.isArray(rawPaths) || rawPaths.length === 0 || rawPaths.length > MAX_BATCH) {
        throw new ValidationError('Choose what to move to the Trash')
      }
      const paths = [...new Set(rawPaths.map((p) => absolute(p)))]
      for (const path of paths) await assertChangeable(path)
      for (const path of paths) await deps.trash(path)
      done(undefined)
    },

    dispose(): void {
      for (const w of watchers.values()) w.close()
      watchers.clear()
    }
  }
}

export type Folders = ReturnType<typeof createFolders>
