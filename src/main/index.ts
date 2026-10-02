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
import { watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { Role } from '@shared/access'
import { APP_ID, APP_NAME, PREVIEW_DATA_ID } from '@shared/app-info'
import { FILE_SCHEME } from '@shared/files'
import { STAGE_VIEW_CHANNEL } from '@shared/stage'
import { VAULT_STATUS_CHANNEL } from '@shared/vault'
import { createApi } from './api'
import { createDeskService } from './deskService'
import { createFilesApi } from './filesApi'
import { createFolders } from './folders'
import { createCalendar } from './mac/calendar'
import { resolveServedPath } from './files'
import { defaultExec, isMac } from './mac/exec'
import { createLauncherSnap } from './mac/launcherSnap'
import { createBackupService, type BackupService } from './backupService'
import { BUILD, IS_PREVIEW } from './buildInfo'
import { openPublicDatabase, openVaultDatabase } from './db/connection'
import { createBroadcaster } from './events'
import { registerIpc } from './ipc'
import { PRESENTATION_MENU_ID, buildMenuTemplate } from './menu'
import { createNotifier, type Notifier } from './notifier'
import { createFileGuard, createProtectedPaths } from './protected'
import { createMeetingService } from './meetingService'
import { createProgressService } from './progressService'
import { createProtectionService } from './protectionService'
import { createRosterMirror, type RosterMirror } from './rosterMirror'
import { createRoleRegistry } from './roles'
import { countExternalDisplays, createStageService } from './stage'
import { createLessonService } from './lessonService'
import { createQuizService } from './quizService'
import { createRosterService } from './rosterService'
import { createScoreService } from './scoreService'
import { createSafeSave } from './safeSave'
import { bundleOf, createUpdater } from './update/updater'
import {
  appVersion,
  chooseFolderDialog,
  confirmSaveOutsideDialog,
  pickAnyFile,
  pickSaveDocxFile,
  pickSavePptxFile,
  pickSaveTableFile,
  pickTableFile
} from './system'
import { createPublicRepositories, createVaultRepositories } from './repos'
import type { Db } from './repos'
import { createVaultGate } from './vault/gate'
import { importLegacyData } from './vault/legacy'
import { createVaultManager } from './vault/manager'
import { createVaultRestore } from './vault/restore'
import { ValidationError } from './validate'
import { createRoleWindow, type WindowEnv } from './windows'

// One folder holds the database, backups and the renderer's own storage:
// ~/Library/Application Support/TeachingOS on a Mac. The Preview app has its own folder beside it,
// holding a copy of the data. TEACHING_OS_DATA_DIR overrides it for tests.
const dataDir =
  process.env['TEACHING_OS_DATA_DIR'] ??
  join(app.getPath('appData'), IS_PREVIEW ? PREVIEW_DATA_ID : APP_ID)
app.setPath('userData', dataDir)
// Where the real app puts the Preview's copy of the data (in the Preview, its own data folder).
const previewDataDir = IS_PREVIEW
  ? dataDir
  : process.env['TEACHING_OS_DATA_DIR']
    ? join(dataDir, 'preview')
    : join(app.getPath('appData'), PREVIEW_DATA_ID)

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
  progress: ReturnType<typeof createProgressService>
  meetings: ReturnType<typeof createMeetingService>
  scores: ReturnType<typeof createScoreService>
  quizzes: ReturnType<typeof createQuizService>
  lessons: ReturnType<typeof createLessonService>
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
  // Protected folders apply everywhere but inside the open Vault, including while it is locked.
  const protectedPaths = createProtectedPaths({ folders: () => publicRepos.protection.list() })
  const safeSave = createSafeSave({
    folders: () => publicRepos.protection.list(),
    isProtected: (path) => protectedPaths.isProtected(path),
    confirmOutside: confirmSaveOutsideDialog
  })

  const toLauncher = (channel: string, payload?: unknown): void =>
    registry.first('launcher')?.webContents.send(channel, payload)

  // The vault: its own database and passcode, closed whenever it is locked.
  const manager = createVaultManager<VaultSession>({
    dir: vaultDir,
    openDb: openVaultDatabase,
    createSession: (vdb) => {
      // Roster changes also refresh the names-only copy the everyday window reads (see rosterMirror.ts).
      let mirror: RosterMirror | null = null
      const repos = createVaultRepositories(vdb, (name, detail) => {
        broadcast(name, detail)
        mirror?.handle(name)
      })
      mirror = createRosterMirror(repos, publicRepos.directory)
      mirror.sync() // on every unlock, which also builds the first copy after an upgrade
      // Exports start in a protected folder, and saving one anywhere else asks first.
      const saveTable = safeSave(pickSaveTableFile)
      const saveDocx = safeSave(pickSaveDocxFile)
      const roster = createRosterService(repos, {
        pickOpenFile: pickTableFile,
        pickSaveFile: saveTable
      })
      const progress = createProgressService(repos, roster.tokens)
      const meetings = createMeetingService(repos, { pickSaveFile: saveDocx })
      const scores = createScoreService(repos, roster.tokens, { pickSaveFile: saveTable })
      const quizzes = createQuizService(repos, { pickSaveFile: saveDocx })
      const lessons = createLessonService(repos, { pickSaveFile: safeSave(pickSavePptxFile) })
      return { repos, roster, progress, meetings, scores, quizzes, lessons }
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

  const guardFor = (role: Role) =>
    createFileGuard({
      paths: protectedPaths,
      allowProtected: () => role === 'vault' && manager.isUnlocked(),
      externalDisplays: () => countExternalDisplays(screen)
    })

  // The Stage: a separate window on the projector that can show only what the Presenter queued.
  const stage = createStageService({
    screen,
    notifier,
    lockVault: (reason) => manager.lock(reason),
    guard: guardFor('stage'),
    offerEnabled: () => publicRepos.settings.get().presentation.offerOnExternalDisplay,
    sendToLauncher: toLauncher,
    onActiveChange: (on) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(PRESENTATION_MENU_ID)
      if (item) item.checked = on
    },
    openWindow: (display) => {
      const b = display?.bounds
      const win = createRoleWindow('stage', windowEnv, {
        ...(b ? { x: b.x, y: b.y, width: b.width, height: b.height } : {}),
        frame: false,
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        movable: false,
        resizable: false,
        fullscreen: process.platform !== 'darwin',
        simpleFullscreen: process.platform === 'darwin'
      })
      // Keys work even while a PDF has focus, which a page-level listener would miss.
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.isAutoRepeat) return
        if (stage.handleKey(input)) event.preventDefault()
      })
      win.on('closed', () => stage.windowClosed())
      return {
        showView: (view) => {
          if (!win.isDestroyed()) win.webContents.send(STAGE_VIEW_CHANNEL, view)
        },
        close: () => {
          if (!win.isDestroyed()) win.destroy()
        }
      }
    }
  })

  const gate = createVaultGate({
    manager,
    presenting: () => stage.isActive(),
    externalDisplays: () => stage.externalDisplays(),
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
    // The Preview's copied settings name the real extra backup folder; its backups stay out of it.
    extraDir: () => (IS_PREVIEW ? null : publicRepos.settings.get().backupFolder)
  })

  const restore = createVaultRestore({
    backups,
    stagingPath: `${manager.paths.db}.restoring`,
    replace: (staged) => manager.replaceDatabase(staged)
  })

  // No window needs the camera, microphone, location or notifications from the page itself
  // (system notifications come from main), so every request is refused.
  for (const role of ['launcher', 'vault', 'stage'] as const) {
    const ses = session.fromPartition(`persist:teachingos-${role}`)
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
  }

  // Each role has its own storage partition, so each needs its own handler for the file scheme, and
  // each applies its own protected-file policy.
  for (const role of ['launcher', 'vault'] as const) {
    const guard = guardFor(role)
    session
      .fromPartition(`persist:teachingos-${role}`)
      .protocol.handle(FILE_SCHEME, async (request) => {
        try {
          const path = await resolveServedPath(request.url, (p) => guard.assertReadable(p))
          return await net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      })
  }

  session
    .fromPartition('persist:teachingos-stage')
    .protocol.handle(FILE_SCHEME, async (request) => {
      try {
        const path = await stage.resolveServed(request.url)
        return await net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })

  // The Mac's folders, one view per role (each sees protected files as its guard allows).
  const foldersFor = (role: Role) =>
    createFolders({
      home: homedir(),
      teachingFolders: () => publicRepos.settings.get().teachingFolders,
      guard: guardFor(role),
      trash: (path) => shell.trashItem(path),
      changed: () => broadcast('folders.changed'),
      // A pinned file that is renamed or moved here stays pinned.
      moved: (from, to) => publicRepos.desk.repath(from, to),
      watch: (dir, onChange) => watch(dir, { persistent: false }, onChange)
    })
  const folders = {
    launcher: foldersFor('launcher'),
    vault: foldersFor('vault'),
    stage: foldersFor('stage')
  }
  const desk = createDeskService(publicRepos.desk, guardFor('launcher'))
  const calendar = createCalendar({
    exec: defaultExec,
    isMac,
    changed: () => broadcast('calendar.changed')
  })

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
      pickFile: pickAnyFile,
      guard: guardFor(role)
    })

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        appName: APP_NAME,
        isMac: process.platform === 'darwin',
        isPackaged: app.isPackaged,
        presenting: false,
        onTogglePresentation: () => {
          try {
            stage.toggle()
          } catch (err) {
            console.error('[stage] could not start:', err)
          }
        }
      })
    )
  )

  const protection = createProtectionService({
    repo: publicRepos.protection,
    paths: protectedPaths,
    chooseFolder: chooseFolderDialog
  })

  const updater = createUpdater({
    build: BUILD,
    arch: process.arch,
    platform: process.platform,
    bundlePath: bundleOf(process.execPath, app.isPackaged, process.platform),
    appsDir: '/Applications',
    downloadDir: join(dataDir, 'updates'),
    fetch: (url) => net.fetch(url, { headers: { Accept: 'application/vnd.github+json' } }),
    exec: defaultExec,
    trash: (path) => shell.trashItem(path),
    presenting: () => stage.isActive(),
    backup: async () => {
      const info = await backups.runAll()
      if (info.vaultError) throw new Error(info.vaultError)
      return { data: info.path, vault: info.vaultName ? join(backupDir, info.vaultName) : null }
    },
    vaultMetaPath: manager.paths.meta,
    previewDataDir,
    relaunch: () => {
      app.relaunch()
      app.quit()
    },
    changed: () => broadcast('updates.changed')
  })
  const updates = {
    status: () => updater.status(),
    check: () => updater.check(),
    install: () => updater.install(),
    tryPreview: (tag: string) => updater.tryPreview(tag),
    refreshPreview: () => updater.refreshPreview(),
    removePreview: () => updater.removePreview()
  }
  const previewDataCopiedAt = (): string | null =>
    IS_PREVIEW ? updater.status().previewDataCopiedAt : null

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
    platform: process.platform,
    build: BUILD,
    previewDataCopiedAt
  }
  const apiFor = (role: Role) =>
    createApi({
      vault: {
        repos: () => manager.session().repos,
        roster: () => manager.session().roster,
        progress: () => manager.session().progress,
        meetings: () => manager.session().meetings,
        scores: () => manager.session().scores,
        quizzes: () => manager.session().quizzes,
        lessons: () => manager.session().lessons
      },
      publicRepos,
      protection,
      backups,
      restore,
      gate,
      stage,
      files: filesApiFor(role),
      folders: folders[role],
      desk,
      calendar,
      updates,
      env
    })
  registerIpc({
    ipc: ipcMain,
    roleOf: (sender) => registry.roleOf(sender),
    apis: { launcher: apiFor('launcher'), vault: apiFor('vault'), stage: apiFor('stage') },
    // Anything that needs the vault is refused while it is locked. A delete or an import that
    // overwrites is backed up first, and refused if the backup cannot be taken.
    beforeCall: async (_role, _ns, _method, access) => {
      if (access.changesMac && IS_PREVIEW)
        throw new ValidationError(
          'Not in the Preview: it works on a copy of your data, but your files and calendar are the real ones. Use Teaching OS for that.'
        )
      if (!access.needsVault) return
      if (stage.isActive())
        throw new ValidationError('End the presentation before using the Vault.')
      manager.assertUnlocked()
      if (!access.backupFirst) return
      try {
        await backups.snapshotVault()
      } catch (err) {
        console.error('[backup] safety backup failed:', err)
        throw new ValidationError(
          'A backup could not be taken first, so nothing was changed. Check the backup folder in Settings.'
        )
      }
    }
  })
  startBackups(backups, notifier)
  // An automated or trial run (its own data folder) never asks GitHub for updates by itself.
  if (!process.env['TEACHING_OS_DATA_DIR']) updater.start()
  app.on('will-quit', () => {
    updater.dispose()
    stage.dispose()
    manager.dispose()
    for (const f of Object.values(folders)) f.dispose()
  })

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
