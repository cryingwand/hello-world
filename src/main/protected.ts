import { realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { ValidationError } from './validate'

export const PROTECTED_MESSAGE = 'That file is in a protected folder. Open it from the Vault.'
export const PROTECTED_DISPLAY_MESSAGE =
  'Protected files are not opened in other apps while another display is connected.'

export interface ProtectedPathsDeps {
  /** The folders the teacher marked protected, as stored. */
  folders: () => readonly string[]
  /** Overridable for tests. */
  realpath?: (path: string) => Promise<string>
  /** Case and Unicode-form differences do not make a different file on a Mac's default disk. */
  foldCase?: boolean
}

export interface ProtectedSnapshot {
  /** No disk access: is this path inside a protected folder as written? */
  lexical(path: string): boolean
  /** The strong check: also follows symlinks and `..` to where the path really points. */
  has(path: string): Promise<boolean>
}

const isMissing = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Decides whether a path is inside a protected folder.
 *
 * It errs toward "protected": comparison ignores case and Unicode form on macOS, symlinks and `..`
 * are resolved before comparing, a path that cannot be examined counts as protected, and a path
 * that is inside a protected folder as written stays protected even if a link points it elsewhere.
 * A folder match is on whole path segments, so `/Exams-old` is not inside `/Exams`.
 *
 * It cannot see hard links or Finder aliases; those are not symlinks and point at the same data
 * without a path inside the folder. The README says so.
 */
export function createProtectedPaths(deps: ProtectedPathsDeps) {
  const real = deps.realpath ?? ((p: string) => realpath(p))
  const fold = (s: string): string => {
    const n = s.normalize('NFC')
    return (deps.foldCase ?? (process.platform === 'darwin' || process.platform === 'win32'))
      ? n.toLowerCase()
      : n
  }
  const inside = (path: string, folder: string): boolean =>
    folder === sep || path === folder || path.startsWith(folder + sep)

  /** The real location of a path, even when the file itself does not exist (yet). */
  async function canonical(path: string): Promise<string> {
    let current = resolve(path)
    const rest: string[] = []
    for (;;) {
      try {
        return join(await real(current), ...rest.reverse())
      } catch (err) {
        if (!isMissing(err)) throw err
        const parent = dirname(current)
        if (parent === current) return join(current, ...rest.reverse())
        rest.push(basename(current))
        current = parent
      }
    }
  }

  async function snapshot(): Promise<ProtectedSnapshot> {
    const listed = deps.folders().map((f) => resolve(f))
    const lexicalFolders = listed.map(fold)
    // A folder that cannot be resolved (a drive that is not mounted) still protects its own path.
    const resolved = await Promise.all(
      listed.map((f) =>
        canonical(f)
          .then(fold)
          .catch(() => fold(f))
      )
    )
    const roots = [...new Set([...lexicalFolders, ...resolved])]
    const lexical = (path: string): boolean => {
      const p = fold(resolve(path))
      return roots.some((r) => inside(p, r))
    }
    return {
      lexical,
      async has(path: string): Promise<boolean> {
        if (roots.length === 0) return false
        if (lexical(path)) return true
        try {
          const real = fold(await canonical(path))
          return roots.some((r) => inside(real, r))
        } catch {
          return true // cannot examine it, so do not show it
        }
      }
    }
  }

  return {
    snapshot,
    async isProtected(path: string): Promise<boolean> {
      return (await snapshot()).has(path)
    }
  }
}

export type ProtectedPaths = ReturnType<typeof createProtectedPaths>

export interface FileGuardDeps {
  paths: ProtectedPaths
  /** True only for a window that may see protected files right now (the unlocked Vault). */
  allowProtected: () => boolean
  /** External displays connected right now. */
  externalDisplays: () => number
}

/**
 * What a window of one role may do with a path. The Vault window may read protected files while it is
 * unlocked; every other window may not, and nothing may hand a protected file to another app while
 * a display is connected.
 */
export function createFileGuard(deps: FileGuardDeps) {
  const isProtected = (path: unknown): Promise<boolean> =>
    typeof path === 'string' ? deps.paths.isProtected(path) : Promise.resolve(false)

  return {
    isProtected,
    /** Throws unless this window may read the file. Non-paths are left for validation to reject. */
    async assertReadable(path: unknown): Promise<void> {
      if (!deps.allowProtected() && (await isProtected(path))) {
        throw new ValidationError(PROTECTED_MESSAGE)
      }
    },
    /** Reading, plus: no handing it to another app (or Finder) while a display is connected. */
    async assertShareable(path: unknown): Promise<void> {
      if (!(await isProtected(path))) return
      if (!deps.allowProtected()) throw new ValidationError(PROTECTED_MESSAGE)
      if (deps.externalDisplays() > 0) throw new ValidationError(PROTECTED_DISPLAY_MESSAGE)
    },
    allowProtected: deps.allowProtected,
    snapshot: deps.paths.snapshot
  }
}

export type FileGuard = ReturnType<typeof createFileGuard>
