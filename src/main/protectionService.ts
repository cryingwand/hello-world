import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ProtectedEntry, ProtectedFolder, ProtectedListing } from '@shared/files'
import { kindOf } from '@shared/files'
import type { ProtectedPaths } from './protected'
import type { PublicRepositories } from './repos'
import { ValidationError } from './validate'

export interface ProtectionServiceDeps {
  repo: PublicRepositories['protection']
  paths: ProtectedPaths
  /** The native folder picker. The renderer never supplies the path itself. */
  chooseFolder: () => Promise<string | null>
}

const MAX_ENTRIES = 1000

const isDirectory = (path: string): Promise<boolean> =>
  stat(path).then(
    (s) => s.isDirectory(),
    () => false
  )

/** Managing the protected folders, and browsing inside them. Only the unlocked Vault can call this. */
export function createProtectionService(deps: ProtectionServiceDeps) {
  const folders = async (): Promise<ProtectedFolder[]> =>
    Promise.all(deps.repo.list().map(async (path) => ({ path, exists: await isDirectory(path) })))

  return {
    folders,

    async chooseAndAdd(): Promise<ProtectedFolder[]> {
      const chosen = await deps.chooseFolder()
      if (chosen) {
        if (!(await isDirectory(chosen))) throw new ValidationError('That is not a folder')
        deps.repo.add(chosen)
      }
      return folders()
    },

    async remove(path: string): Promise<ProtectedFolder[]> {
      deps.repo.remove(path)
      return folders()
    },

    async browse(dir: string): Promise<ProtectedListing> {
      if (typeof dir !== 'string' || dir.includes('\0') || !isAbsolute(dir))
        throw new ValidationError('That is not a valid folder')
      const here = resolve(dir)
      // Anything outside a protected folder is refused, so this cannot list arbitrary directories.
      if (!(await deps.paths.isProtected(here)) || !(await isDirectory(here)))
        throw new ValidationError('That folder is not one of your protected folders')

      const names = (await readdir(here)).filter((n) => !n.startsWith('.'))
      const entries: ProtectedEntry[] = []
      for (const name of names.slice(0, MAX_ENTRIES)) {
        const path = join(here, name)
        const st = await stat(path).catch(() => null)
        if (!st || (!st.isFile() && !st.isDirectory())) continue
        entries.push({
          name,
          path,
          isDir: st.isDirectory(),
          kind: kindOf(path),
          size: st.isFile() ? st.size : 0,
          mtime: st.mtimeMs
        })
      }
      entries.sort(
        (a, b) =>
          Number(b.isDir) - Number(a.isDir) ||
          a.name.localeCompare(b.name, undefined, { numeric: true })
      )

      // There is no way up from the protected folder itself.
      const listed = deps.repo.list().map((f) => resolve(f))
      const up = dirname(here)
      const parent = listed.includes(here) || !(await deps.paths.isProtected(up)) ? null : up
      return { dir: here, parent, entries, truncated: names.length > MAX_ENTRIES }
    }
  }
}

export type ProtectionService = ReturnType<typeof createProtectionService>
