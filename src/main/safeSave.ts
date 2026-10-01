import { basename, dirname, join } from 'node:path'

export interface SafeSaveDeps {
  /** The protected folders, as stored. */
  folders: () => readonly string[]
  isProtected: (path: string) => Promise<boolean>
  /** Asks whether to keep a path outside every protected folder. True saves it there anyway. */
  confirmOutside: (path: string) => Promise<boolean>
}

/** A native save dialog: starts at `defaultPath` (a full path, or only a file name). */
export type ShowSave<A extends unknown[]> = (
  defaultPath: string,
  ...rest: A
) => Promise<string | null>

/**
 * Save dialogs for files exported from the Vault (gradebooks, rosters, meeting notes, quizzes and
 * answer keys, lesson decks). They open in a protected folder, the last one used or else the first,
 * because a file saved anywhere else shows up in everyday file search and can be queued on the Stage.
 * Choosing a place outside them asks first; declining opens the dialog again. With no protected
 * folders there is nothing to steer towards, so the dialog behaves as before.
 */
export function createSafeSave(deps: SafeSaveDeps) {
  let lastDir: string | null = null

  const startDir = async (): Promise<string | null> => {
    const folders = deps.folders()
    if (folders.length === 0) return null
    if (lastDir && (await deps.isProtected(lastDir))) return lastDir
    return folders[0]
  }

  return function wrap<A extends unknown[]>(show: ShowSave<A>) {
    return async (defaultName: string, ...rest: A): Promise<string | null> => {
      for (;;) {
        const dir = await startDir()
        const path = await show(dir ? join(dir, basename(defaultName)) : defaultName, ...rest)
        if (!path) return null
        if (!dir || (await deps.isProtected(path))) {
          if (dir) lastDir = dirname(path)
          return path
        }
        if (await deps.confirmOutside(path)) return path
      }
    }
  }
}
