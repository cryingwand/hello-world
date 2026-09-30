import {
  app,
  BrowserWindow,
  nativeImage,
  net,
  protocol,
  screen,
  shell,
  systemPreferences
} from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { APP_ID, APP_NAME } from '@shared/app-info'
import { FILE_SCHEME } from '@shared/files'
import { createApi } from './api'
import { createFilesApi } from './filesApi'
import { resolveServedPath } from './files'
import { defaultExec, isMac } from './mac/exec'
import { createLauncherSnap } from './mac/launcherSnap'
import { needsDailyBackup, listBackups, runBackup } from './backup'
import { openDatabase } from './db/connection'
import { broadcastChange } from './events'
import { registerIpc } from './ipc'
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
let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  // Fill the usable screen (below the menu bar, clear of the dock) like a desktop environment.
  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    title: APP_NAME,
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    show: false,
    backgroundColor: '#1b1d23',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.once('ready-to-show', () => win.show())

  // Never navigate the shell itself; hand external links to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** Backup on launch, then check hourly so a long-running session still gets a daily backup. */
function startBackups(database: Db, repos: ReturnType<typeof createRepositories>): void {
  const run = (): void => {
    runBackup(database, { dir: backupDir, extraDir: repos.settings.get().backupFolder }).catch(
      (err) => console.error('[backup] failed:', err)
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
  const repos = createRepositories(db, broadcastChange)
  const roster = createRosterService(repos, {
    pickOpenFile: pickTableFile,
    pickSaveFile: pickSaveTableFile
  })
  protocol.handle(FILE_SCHEME, async (request) => {
    try {
      const path = await resolveServedPath(request.url)
      return await net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  const filesApi = createFilesApi({
    settings: () => repos.settings.get(),
    exec: defaultExec,
    home: homedir(),
    isMac,
    // On a Mac this also shows the system's Accessibility prompt the first time it is asked.
    isTrusted: () =>
      process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(true),
    launcher: createLauncherSnap(() => mainWindow, screen),
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
  registerIpc(
    createApi(db, repos, roster, scores, filesApi, {
      dataDir,
      dbPath,
      backupDir,
      chooseFolder: chooseFolderDialog,
      openAccessibilitySettings: async () => {
        await shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
        )
      },
      version: appVersion(),
      platform: process.platform
    })
  )
  startBackups(db, repos)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  db?.close()
  db = null
})
