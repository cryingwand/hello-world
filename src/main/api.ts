import type { ApiContract, SystemInfo } from '@shared/api'
import type { BackupService } from './backupService'
import type { PresentationService } from './presentation'
import type { PublicRepositories, Repositories } from './repos'
import type { RosterService } from './rosterService'
import type { ScoreService } from './scoreService'
import type { VaultGate } from './vault/gate'

export interface ApiEnv {
  dataDir: string
  dbPath: string
  vaultPath: string
  backupDir: string
  chooseFolder: () => Promise<string | null>
  openAccessibilitySettings: () => Promise<void>
  openVaultWindow: () => void
  version: string
  platform: string
}

export interface ApiDeps {
  /** Resolve the open vault's objects; each throws while the vault is locked. */
  vault: { repos: () => Repositories; roster: () => RosterService; scores: () => ScoreService }
  publicRepos: PublicRepositories
  backups: BackupService
  gate: VaultGate<unknown>
  presentation: PresentationService
  files: ApiContract['files']
  env: ApiEnv
}

/** Wires the repositories and services into the shape a window sees as `window.api`. */
export function createApi(deps: ApiDeps): ApiContract {
  const { env, presentation, gate } = deps
  const repos = (): Repositories => deps.vault.repos()
  const roster = (): RosterService => deps.vault.roster()
  const scores = (): ScoreService => deps.vault.scores()
  return {
    terms: {
      list: () => repos().terms.list(),
      create: (input) => repos().terms.create(input),
      update: (id, patch) => repos().terms.update(id, patch),
      delete: (id) => repos().terms.delete(id)
    },
    students: {
      list: (query) => repos().students.list(query),
      get: (id) => repos().students.get(id),
      create: (input) => repos().students.create(input),
      update: (id, patch) => repos().students.update(id, patch),
      delete: (id) => repos().students.delete(id)
    },
    classes: {
      list: (termId) => repos().classes.list(termId),
      get: (id) => repos().classes.get(id),
      create: (input) => repos().classes.create(input),
      update: (id, patch) => repos().classes.update(id, patch),
      delete: (id) => repos().classes.delete(id),
      roster: (classId) => repos().classes.roster(classId),
      enroll: (classId, studentId) => repos().classes.enroll(classId, studentId),
      unenroll: (classId, studentId) => repos().classes.unenroll(classId, studentId),
      forStudent: (studentId) => repos().classes.forStudent(studentId)
    },
    grading: {
      categories: (classId) => repos().grading.categories(classId),
      createCategory: (input) => repos().grading.createCategory(input),
      updateCategory: (id, patch) => repos().grading.updateCategory(id, patch),
      deleteCategory: (id) => repos().grading.deleteCategory(id),
      assignments: (classId) => repos().grading.assignments(classId),
      createAssignment: (input) => repos().grading.createAssignment(input),
      updateAssignment: (id, patch) => repos().grading.updateAssignment(id, patch),
      deleteAssignment: (id) => repos().grading.deleteAssignment(id),
      scores: (classId) => repos().grading.scores(classId),
      setScore: (input) => repos().grading.setScore(input),
      setScores: (inputs) => repos().grading.setScores(inputs)
    },
    roster: {
      chooseFile: () => roster().chooseFile(),
      readSheet: (token, sheet) => roster().readSheet(token, sheet),
      preview: (request) => roster().preview(request),
      commit: (request) => roster().commit(request),
      exportClass: (classId, format) => roster().exportClass(classId, format)
    },
    vaultGate: {
      openWindow: () => env.openVaultWindow(),
      status: () => gate.status(),
      setup: (passcode, touchId) => gate.setup(passcode, touchId),
      unlock: (passcode) => gate.unlock(passcode),
      unlockWithTouchId: () => gate.unlockWithTouchId(),
      lock: () => gate.lock()
    },
    vault: {
      touch: () => gate.touch(),
      changePasscode: (current, next) => gate.changePasscode(current, next),
      settings: () => gate.settings(),
      updateSettings: (patch) => gate.updateSettings(patch)
    },
    presentation: {
      setActive: (on) => presentation.setActive(!!on),
      state: () => ({
        externalDisplays: presentation.externalDisplays(),
        offerEnabled: presentation.offerEnabled()
      })
    },
    gradebook: {
      previewScores: (request) => scores().previewScores(request),
      commitScores: (request) => scores().commitScores(request),
      exportClass: (classId, format) => scores().exportClass(classId, format)
    },
    files: deps.files,
    fileLinks: {
      list: (type, id) => repos().fileLinks.list(type, id),
      add: (input) => repos().fileLinks.add(input),
      remove: (id) => repos().fileLinks.remove(id)
    },
    settings: {
      get: () => deps.publicRepos.settings.get(),
      update: (patch) => deps.publicRepos.settings.update(patch)
    },
    backup: {
      runNow: () => deps.backups.runAll(),
      list: () => deps.backups.list()
    },
    system: {
      info: (): SystemInfo => ({
        dataDir: env.dataDir,
        dbPath: env.dbPath,
        vaultPath: env.vaultPath,
        backupDir: env.backupDir,
        platform: env.platform,
        version: env.version
      }),
      chooseFolder: () => env.chooseFolder(),
      openAccessibilitySettings: () => env.openAccessibilitySettings()
    }
  }
}
