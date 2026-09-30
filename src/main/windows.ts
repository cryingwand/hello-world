import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron'
import type { Role } from '@shared/access'
import { APP_NAME } from '@shared/app-info'
import type { RoleRegistry } from './roles'

export interface WindowEnv {
  registry: RoleRegistry<BrowserWindow>
  preload: string
  /** Built renderer entry, used when there is no dev server. */
  indexHtml: string
  /** The dev server URL, when running `npm run dev`. */
  devUrl?: string
}

const TITLES: Record<Role, string> = {
  launcher: APP_NAME,
  vault: `${APP_NAME} Vault`,
  stage: `${APP_NAME} Stage`
}

/**
 * Creates a window with a role. Each role gets its own storage partition, so the launcher, the
 * vault and the stage never share cookies, storage or protocol handlers. The renderer learns which
 * shell to draw from `window.api.role`, which the main process answers from its own records.
 */
export function createRoleWindow(
  role: Role,
  env: WindowEnv,
  options: BrowserWindowConstructorOptions = {}
): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    title: TITLES[role],
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    show: false,
    backgroundColor: '#1b1d23',
    ...options,
    webPreferences: {
      preload: env.preload,
      partition: `persist:teachingos-${role}`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const contentsId = win.webContents.id
  env.registry.add(role, contentsId, win)
  win.on('closed', () => env.registry.remove(contentsId))
  // Keep the role's title: the page's own <title> would make every window look the same.
  win.on('page-title-updated', (event) => event.preventDefault())
  win.once('ready-to-show', () => win.show())

  // Never navigate the window itself; hand external links to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (env.devUrl) void win.loadURL(env.devUrl)
  else void win.loadFile(env.indexHtml)
  return win
}
