import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { Role } from '@shared/access'
import { APP_ID, APP_NAME } from '@shared/app-info'
import { PRESENTATION_TOGGLE_CHANNEL } from '@shared/events'
import { FILE_SCHEME } from '@shared/files'
import { createApi } from './api'
import { createFilesApi } from './filesApi'
import { resolveServedPath } from './files'
import { defaultExec, isMac } from './mac/exec'
import { createLauncherSnap } from './mac/launcherSnap'
import { needsDailyBackup, listBackups, runBackup } from './backup'
import { openDatabase } from './db/connection'
import { createBroadcaster } from './events'
import { registerIpc } from './ipc'
import { PRESENTATION_MENU_ID, buildMenuTemplate } from './menu'
import { createNotifier, type Notifier } from './notifier'
import { createPresentationService } from './presentation'
import { createRoleRegistry } from './roles'
import { createRosterService } from './rosterService'
import { createScoreService } from './scoreService'
import {
  appVersion,
  chooseFolderDialog,
  pickAnyFile,
  pickSaveTableFile,
  pickTableFile
} from './system'
import { createRepositories } from './repos'
import type { Db } from './repos'
import { createRoleWindow, type WindowEnv } from './windows'

// One folder holds the database, backups and the renderer's own storage:
// ~/Library/Application Support/TeachingOS on a Mac. TEACHING_OS_DATA_DIR overrides it for tests.
const dataDir = process.env['TEACHING_OS_DATA_DIR'] ?? join(app.getPath('appData'), APP_ID)
app.setPath('userData', dataDir)

// Serves PDFs and images to the renderer through a validated custom scheme (see resolveServedPath).
protocol.registerSchemesAsPrivileged([
  {
    scheme: FILE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const dbPath = join(dataDir, 'data.sqlite')
const backupDir = join(dataDir, 'backups')

let db: Db | null = null
const registry = createRoleRegistry<BrowserWindow>()

const windowEnv: WindowEnv = {
  registry,
  preload: join(__dirname, '../preload/index.js'),
  indexHtml: join(__dirname, '../renderer/index.html'),
  devUrl: process.env['ELECTRON_RENDERER_URL']
}

function openLauncher(): BrowserWindow {
  const existing = registry.first('launcher')
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }
  return createRoleWindow('launcher', windowEnv)
}

function openVaultWindow(): void {
  const existing = registry.first('vault')
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }
  createRoleWindow('vault', windowEnv)
}

/** Backup on launch, then check hourly so a long-running session still gets a daily backup. */
function startBackups(
  database: Db,
  repos: ReturnType<typeof createRepositories>,
  notifier: Notifier
): void {
  const run = (): void => {
    runBackup(database, { dir: backupDir, extraDir: repos.settings.get().backupFolder }).catch(
      (err) => {
        console.error('[backup] failed:', err)
        notifier.notify({
          title: 'Teaching OS backup failed',
          body: 'Your data is safe, but the latest backup could not be written. Open Settings to check the backup folder.'
        })
      }
    )
  }
  run()
  setInterval(
    () => {
      if (needsDailyBackup(backupDir, new Date())) run()
    },
    60 * 60 * 1000
  ).unref()
  console.log(`[backup] ${listBackups(backupDir).length} backups on disk`)
}

void app.whenReady().then(() => {
  db = openDatabase(dbPath)
  const broadcast = createBroadcaster((role) =>
    registry
      .windows(role)
      .filter((w) => !w.isDestroyed())
      .map((w) => ({ send: (channel, payload) => w.webContents.send(channel, payload) }))
  )
  const repos = createRepositories(db, broadcast)
  const roster = createRosterService(repos, {
    pickOpenFile: pickTableFile,
    pickSaveFile: pickSaveTableFile
  })

  // Each role has its own storage partition, so each needs its own handler for the file scheme.
  for (const role of ['launcher', 'vault'] as const) {
    session
      .fromPartition(`persist:teachingos-${role}`)
      .protocol.handle(FILE_SCHEME, async (request) => {
        try {
          const path = await resolveServedPath(request.url)
          return await net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      })
  }

  const filesApiFor = (role: Role) =>
    createFilesApi({
      settings: () => repos.settings.get(),
      exec: defaultExec,
      home: homedir(),
      isMac,
      // On a Mac this also shows the system's Accessibility prompt the first time it is asked.
      isTrusted: () =>
        process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(true),
      // Snapping moves the window that asked, so each role gets its own.
      launcher: createLauncherSnap(() => registry.first(role) ?? null, screen),
      thumbnail: async (path, size) => {
        // Quick Look thumbnails exist on macOS only.
        if (typeof nativeImage.createThumbnailFromPath !== 'function') return null
        const image = await nativeImage.createThumbnailFromPath(path, { width: size, height: size })
        return image.isEmpty() ? null : image.toDataURL()
      },
      reveal: (path) => shell.showItemInFolder(path),
      pickFile: pickAnyFile
    })
  const scores = createScoreService(repos, roster.tokens, { pickSaveFile: pickSaveTableFile })

  // System notifications go through one place so presentation mode can hold them back.
  const notifier = createNotifier({
    show: (n) => {
      if (Notification.isSupported()) new Notification({ title: n.title, body: n.body }).show()
    }
  })
  const toLauncher = (channel: string, payload?: unknown): void =>
    registry.first('launcher')?.webContents.send(channel, payload)
  const presentation = createPresentationService({
    screen,
    notifier,
    offerEnabled: () => repos.settings.get().presentation.offerOnExternalDisplay,
    send: (channel, payload) => toLauncher(channel, payload),
    onActiveChange: (on) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(PRESENTATION_MENU_ID)
      if (item) item.checked = on
    }
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        appName: APP_NAME,
        isMac: process.platform === 'darwin',
        isPackaged: app.isPackaged,
        presenting: false,
        onTogglePresentation: () => toLauncher(PRESENTATION_TOGGLE_CHANNEL)
      })
    )
  )

  const apiEnv = {
    dataDir,
    dbPath,
    backupDir,
    chooseFolder: chooseFolderDialog,
    openAccessibilitySettings: async () => {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      )
    },
    openVaultWindow,
    version: appVersion(),
    platform: process.platform
  }
  registerIpc({
    ipc: ipcMain,
    roleOf: (sender) => registry.roleOf(sender),
    apis: {
      launcher: createApi(db, repos, roster, scores, presentation, filesApiFor('launcher'), apiEnv),
      vault: createApi(db, repos, roster, scores, presentation, filesApiFor('vault'), apiEnv)
    }
  })
  startBackups(db, repos, notifier)

  openLauncher()
  app.on('activate', () => {
    if (registry.count() === 0) openLauncher()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  db?.close()
  db = null
})
