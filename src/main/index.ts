import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
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
import { VAULT_STATUS_CHANNEL } from '@shared/vault'
import { createApi } from './api'
import { createFilesApi } from './filesApi'
import { resolveServedPath } from './files'
import { defaultExec, isMac } from './mac/exec'
import { createLauncherSnap } from './mac/launcherSnap'
import { createBackupService, type BackupService } from './backupService'
import { openPublicDatabase, openVaultDatabase } from './db/connection'
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
import { createPublicRepositories, createVaultRepositories } from './repos'
import type { Db } from './repos'
import { createVaultGate } from './vault/gate'
import { importLegacyData } from './vault/legacy'
import { createVaultManager } from './vault/manager'
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
const vaultDir = join(dataDir, 'vault')
const backupDir = join(dataDir, 'backups')

let publicDb: Db | null = null
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
function startBackups(backups: BackupService, notifier: Notifier): void {
  const run = (): void => {
    backups.runAll().then(
      (info) => {
        if (info.vaultError) console.error('[backup] vault backup failed:', info.vaultError)
      },
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
      if (backups.needsDaily()) run()
    },
    60 * 60 * 1000
  ).unref()
}

interface VaultSession {
  repos: ReturnType<typeof createVaultRepositories>
  roster: ReturnType<typeof createRosterService>
  scores: ReturnType<typeof createScoreService>
}

void app.whenReady().then(() => {
  const db = openPublicDatabase(dbPath)
  publicDb = db
  const toRoles = (roles: Role[], channel: string, payload?: unknown): void => {
    for (const role of roles) {
      for (const w of registry.windows(role))
        if (!w.isDestroyed()) w.webContents.send(channel, payload)
    }
  }
  const broadcast = createBroadcaster((role) =>
    registry
      .windows(role)
      .filter((w) => !w.isDestroyed())
      .map((w) => ({ send: (channel, payload) => w.webContents.send(channel, payload) }))
  )
  const publicRepos = createPublicRepositories(db, broadcast)

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
    offerEnabled: () => publicRepos.settings.get().presentation.offerOnExternalDisplay,
    send: (channel, payload) => toLauncher(channel, payload),
    onActiveChange: (on) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(PRESENTATION_MENU_ID)
      if (item) item.checked = on
    }
  })

  // The vault: its own database and passcode, closed whenever it is locked.
  const manager = createVaultManager<VaultSession>({
    dir: vaultDir,
    openDb: openVaultDatabase,
    createSession: (vdb) => {
      const repos = createVaultRepositories(vdb, broadcast)
      const roster = createRosterService(repos, {
        pickOpenFile: pickTableFile,
        pickSaveFile: pickSaveTableFile
      })
      const scores = createScoreService(repos, roster.tokens, { pickSaveFile: pickSaveTableFile })
      return { repos, roster, scores }
    },
    // A database from before the vault existed is moved in the first time the vault opens.
    afterOpen: (vdb) => void importLegacyData(db, vdb, { backupDir }),
    onLock: () => {
      // Closing the windows throws away everything they were showing.
      for (const w of registry.windows('vault')) if (!w.isDestroyed()) w.destroy()
    },
    onStatusChange: (status) => toRoles(['launcher', 'vault'], VAULT_STATUS_CHANNEL, status),
    touchId: {
      available: () =>
        process.platform === 'darwin' &&
        typeof systemPreferences.canPromptTouchID === 'function' &&
        systemPreferences.canPromptTouchID(),
      prompt: (reason) => systemPreferences.promptTouchID(reason)
    }
  })
  powerMonitor.on('lock-screen', () => manager.lock('screen-lock'))
  powerMonitor.on('suspend', () => manager.lock('sleep'))

  const gate = createVaultGate({
    manager,
    presenting: () => presentation.isActive(),
    externalDisplays: () => presentation.externalDisplays(),
    confirmExternalDisplay: async () => {
      const win = registry.first('vault')
      const options = {
        type: 'warning' as const,
        buttons: ['Open Vault anyway', 'Keep it locked'],
        defaultId: 1,
        cancelId: 1,
        message: 'Another display is connected.',
        detail: 'Anything you open in the Vault could be visible to the people watching it.'
      }
      const res = win
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)
      return res.response === 0
    }
  })

  const backups = createBackupService({
    dir: backupDir,
    publicDb: () => db,
    vault: {
      open: () => (manager.isUnlocked() ? manager.database() : null),
      dbPath: manager.paths.db
    },
    extraDir: () => publicRepos.settings.get().backupFolder
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
      settings: () => publicRepos.settings.get(),
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

  const env = {
    dataDir,
    dbPath,
    vaultPath: manager.paths.db,
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
  const apiFor = (role: Role) =>
    createApi({
      vault: {
        repos: () => manager.session().repos,
        roster: () => manager.session().roster,
        scores: () => manager.session().scores
      },
      publicRepos,
      backups,
      gate,
      presentation,
      files: filesApiFor(role),
      env
    })
  registerIpc({
    ipc: ipcMain,
    roleOf: (sender) => registry.roleOf(sender),
    apis: { launcher: apiFor('launcher'), vault: apiFor('vault') },
    // Anything that needs the vault is refused while it is locked.
    beforeCall: (_role, _ns, _method, access) => {
      if (access.needsVault) manager.assertUnlocked()
    }
  })
  startBackups(backups, notifier)
  app.on('will-quit', () => manager.dispose())

  openLauncher()
  app.on('activate', () => {
    if (registry.count() === 0) openLauncher()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  publicDb?.close()
  publicDb = null
})
