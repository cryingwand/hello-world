import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { APP_ID, APP_NAME } from '@shared/app-info'
import { createApi } from './api'
import { needsDailyBackup, listBackups, runBackup } from './backup'
import { openDatabase } from './db/connection'
import { broadcastChange } from './events'
import { registerIpc } from './ipc'
import { appVersion, chooseFolderDialog } from './system'
import { createRepositories } from './repos'
import type { Db } from './repos'

// One folder holds the database, backups and the renderer's own storage:
// ~/Library/Application Support/TeachingOS on a Mac. TEACHING_OS_DATA_DIR overrides it for tests.
const dataDir = process.env['TEACHING_OS_DATA_DIR'] ?? join(app.getPath('appData'), APP_ID)
app.setPath('userData', dataDir)

const dbPath = join(dataDir, 'data.sqlite')
const backupDir = join(dataDir, 'backups')

let db: Db | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#1b1d23',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
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
  registerIpc(
    createApi(db, repos, {
      dataDir,
      dbPath,
      backupDir,
      chooseFolder: chooseFolderDialog,
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
