import type { BrowserWindow, Rectangle, Screen } from 'electron'
import { splitWorkArea } from '@shared/files'
import type { Rect } from '@shared/geometry'
import type { LauncherSnap } from './opener'

interface Saved {
  bounds: Rectangle
  maximized: boolean
}

/** Moves the launcher window to the left half of its display, and puts it back afterwards. */
export function createLauncherSnap(
  getWindow: () => BrowserWindow | null,
  screen: Screen
): LauncherSnap {
  let saved: Saved | null = null

  const leaveFullScreen = (win: BrowserWindow): Promise<void> =>
    new Promise((resolve) => {
      if (!win.isFullScreen()) return resolve()
      const done = (): void => resolve()
      win.once('leave-full-screen', done)
      win.setFullScreen(false)
      setTimeout(done, 1500) // the macOS transition is animated; do not wait forever
    })

  return {
    async snapLeft(): Promise<Rect | null> {
      const win = getWindow()
      if (!win || win.isDestroyed()) return null
      if (!saved) saved = { bounds: win.getBounds(), maximized: win.isMaximized() }
      await leaveFullScreen(win)
      if (win.isMaximized()) win.unmaximize()
      // Use the display the window is on, and the work area so the menu bar and dock stay clear.
      const area = screen.getDisplayMatching(saved.bounds).workArea
      const { left, right } = splitWorkArea(area)
      win.setBounds(left)
      return right
    },
    restore(): void {
      const win = getWindow()
      if (!saved) return
      const s = saved
      saved = null
      if (!win || win.isDestroyed()) return
      win.setBounds(s.bounds)
      if (s.maximized) win.maximize()
    }
  }
}
