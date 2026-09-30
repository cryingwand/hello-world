import { stat } from 'node:fs/promises'
import type { ApiContract } from '@shared/api'
import type { AppSettings } from '@shared/models'
import * as files from './files'
import type { Exec } from './mac/exec'
import { openInApp, type LauncherSnap } from './mac/opener'
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
        stat: async (p) => {
          try {
            const st = await stat(p)
            return { isFile: st.isFile(), size: st.size, mtimeMs: st.mtimeMs }
          } catch {
            return null
          }
        }
      }),
    info: (path) => files.fileInfo(path),
    readText: (path) => files.readText(path),
    writeText: async (path, text, expectedMtime) =>
      files.writeText(path, text, v.num(expectedMtime, 'mtime')),
    docxHtml: (path) => files.docxHtml(path),
    table: (path, sheet) => files.tableView(path, sheet),
    thumbnail: async (path) => {
      const f = await files.assertFile(path)
      return env.thumbnail(f.path, 512).catch(() => null)
    },
    open: async (req) => {
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
      const f = await files.assertFile(path)
      env.reveal(f.path)
    },
    restoreLayout: () => env.launcher.restore(),
    pickFile: () => env.pickFile()
  }
}
