import { stat } from 'node:fs/promises'
import type { ApiContract } from '@shared/api'
import type { AppSettings } from '@shared/models'
import * as files from './files'
import type { Exec } from './mac/exec'
import { openInApp, type LauncherSnap } from './mac/opener'
import type { FileGuard } from './protected'
import { searchFiles } from './mac/spotlight'
import * as v from './validate'

export interface FilesEnv {
  settings: () => AppSettings
  exec: Exec
  home: string
  isMac: () => boolean
  isTrusted: () => boolean
  launcher: LauncherSnap
  thumbnail: (path: string, size: number) => Promise<string | null>
  reveal: (path: string) => void
  pickFile: () => Promise<string | null>
  /** What this window may do with protected files. */
  guard: FileGuard
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  pollMs?: number
  snapTimeoutMs?: number
}

export function createFilesApi(env: FilesEnv): ApiContract['files'] {
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  return {
    search: (query) =>
      searchFiles(query, env.settings().teachingFolders, {
        exec: env.exec,
        home: env.home,
        isMac: env.isMac,
        protection: { snapshot: env.guard.snapshot, hide: !env.guard.allowProtected() },
        stat: async (p) => {
          try {
            const st = await stat(p)
            return { isFile: st.isFile(), size: st.size, mtimeMs: st.mtimeMs }
          } catch {
            return null
          }
        }
      }),
    info: async (path) => {
      const protectedFile = await env.guard.isProtected(path)
      // Outside the Vault a protected file looks like one that does not exist.
      if (protectedFile && !env.guard.allowProtected()) return null
      const info = await files.fileInfo(path)
      return info && protectedFile ? { ...info, isProtected: true } : info
    },
    readText: async (path) => {
      await env.guard.assertReadable(path)
      return files.readText(path)
    },
    writeText: async (path, text, expectedMtime) => {
      await env.guard.assertReadable(path)
      return files.writeText(path, text, v.num(expectedMtime, 'mtime'))
    },
    docxHtml: async (path) => {
      await env.guard.assertReadable(path)
      return files.docxHtml(path)
    },
    table: async (path, sheet) => {
      await env.guard.assertReadable(path)
      return files.tableView(path, sheet)
    },
    thumbnail: async (path) => {
      await env.guard.assertReadable(path)
      const f = await files.assertFile(path)
      return env.thumbnail(f.path, 512).catch(() => null)
    },
    open: async (req) => {
      await env.guard.assertShareable(req?.path)
      const f = await files.assertFile(req?.path)
      return openInApp(
        { path: f.path, app: req.app, snap: !!req.snap },
        {
          exec: env.exec,
          isMac: env.isMac,
          isTrusted: env.isTrusted,
          launcher: env.launcher,
          sleep,
          now: env.now ?? Date.now,
          pollMs: env.pollMs,
          timeoutMs: env.snapTimeoutMs
        }
      )
    },
    reveal: async (path) => {
      await env.guard.assertShareable(path)
      const f = await files.assertFile(path)
      env.reveal(f.path)
    },
    restoreLayout: () => env.launcher.restore(),
    pickFile: async () => {
      const path = await env.pickFile()
      // The native picker can browse anywhere; a protected choice is refused outside the Vault.
      if (path) await env.guard.assertReadable(path)
      return path
    }
  }
}
