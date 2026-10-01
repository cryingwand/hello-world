import type { MenuItemConstructorOptions } from 'electron'

export const PRESENTATION_MENU_ID = 'presentation-mode'
export const PRESENTATION_ACCELERATOR = 'CommandOrControl+Shift+P'

export interface MenuOptions {
  appName: string
  isMac: boolean
  isPackaged: boolean
  presenting: boolean
  onTogglePresentation: () => void
}

/**
 * The application menu. Presentation mode lives here so its hotkey is a real menu accelerator: it
 * works whichever part of the window has focus, including inside a PDF preview, which a page-level
 * key listener would miss.
 */
export function buildMenuTemplate(o: MenuOptions): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        id: PRESENTATION_MENU_ID,
        label: 'Presentation Mode',
        type: 'checkbox',
        checked: o.presenting,
        accelerator: PRESENTATION_ACCELERATOR,
        click: () => o.onTogglePresentation()
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      // Developer tools are for building the app, not for a classroom.
      ...(o.isPackaged
        ? []
        : ([
            { type: 'separator' },
            { role: 'reload' },
            { role: 'toggleDevTools' }
          ] as MenuItemConstructorOptions[]))
    ]
  }
  return [
    ...(o.isMac ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[]) : []),
    { role: 'editMenu' },
    view,
    { role: 'windowMenu' }
  ]
}
