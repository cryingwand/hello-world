import type { ApiContract, SystemInfo } from '@shared/api'
import { listBackups, runBackup } from './backup'
import type { Db } from './repos/types'
import type { Repositories } from './repos'
import type { RosterService } from './rosterService'
import type { PresentationService } from './presentation'
import type { ScoreService } from './scoreService'

export interface ApiEnv {
  dataDir: string
  dbPath: string
  backupDir: string
  chooseFolder: () => Promise<string | null>
  openAccessibilitySettings: () => Promise<void>
  version: string
  platform: string
}

/** Wires the repositories and services into the shape the renderer sees as `window.api`. */
export function createApi(
  db: Db,
  repos: Repositories,
  roster: RosterService,
  scores: ScoreService,
  presentation: PresentationService,
  filesApi: ApiContract['files'],
  env: ApiEnv
): ApiContract {
  return {
    terms: {
      list: () => repos.terms.list(),
      create: (input) => repos.terms.create(input),
      update: (id, patch) => repos.terms.update(id, patch),
      delete: (id) => repos.terms.delete(id)
    },
    students: {
      list: (query) => repos.students.list(query),
      get: (id) => repos.students.get(id),
      create: (input) => repos.students.create(input),
      update: (id, patch) => repos.students.update(id, patch),
      delete: (id) => repos.students.delete(id)
    },
    classes: {
      list: (termId) => repos.classes.list(termId),
      get: (id) => repos.classes.get(id),
      create: (input) => repos.classes.create(input),
      update: (id, patch) => repos.classes.update(id, patch),
      delete: (id) => repos.classes.delete(id),
      roster: (classId) => repos.classes.roster(classId),
      enroll: (classId, studentId) => repos.classes.enroll(classId, studentId),
      unenroll: (classId, studentId) => repos.classes.unenroll(classId, studentId),
      forStudent: (studentId) => repos.classes.forStudent(studentId)
    },
    grading: {
      categories: (classId) => repos.grading.categories(classId),
      createCategory: (input) => repos.grading.createCategory(input),
      updateCategory: (id, patch) => repos.grading.updateCategory(id, patch),
      deleteCategory: (id) => repos.grading.deleteCategory(id),
      assignments: (classId) => repos.grading.assignments(classId),
      createAssignment: (input) => repos.grading.createAssignment(input),
      updateAssignment: (id, patch) => repos.grading.updateAssignment(id, patch),
      deleteAssignment: (id) => repos.grading.deleteAssignment(id),
      scores: (classId) => repos.grading.scores(classId),
      setScore: (input) => repos.grading.setScore(input),
      setScores: (inputs) => repos.grading.setScores(inputs)
    },
    roster: {
      chooseFile: () => roster.chooseFile(),
      readSheet: (token, sheet) => roster.readSheet(token, sheet),
      preview: (request) => roster.preview(request),
      commit: (request) => roster.commit(request),
      exportClass: (classId, format) => roster.exportClass(classId, format)
    },
    presentation: {
      setActive: (on) => presentation.setActive(!!on),
      state: () => ({
        externalDisplays: presentation.externalDisplays(),
        offerEnabled: presentation.offerEnabled()
      })
    },
    gradebook: {
      previewScores: (request) => scores.previewScores(request),
      commitScores: (request) => scores.commitScores(request),
      exportClass: (classId, format) => scores.exportClass(classId, format)
    },
    files: filesApi,
    fileLinks: {
      list: (type, id) => repos.fileLinks.list(type, id),
      add: (input) => repos.fileLinks.add(input),
      remove: (id) => repos.fileLinks.remove(id)
    },
    settings: {
      get: () => repos.settings.get(),
      update: (patch) => repos.settings.update(patch)
    },
    backup: {
      runNow: () =>
        runBackup(db, { dir: env.backupDir, extraDir: repos.settings.get().backupFolder }),
      list: () => listBackups(env.backupDir)
    },
    system: {
      info: (): SystemInfo => ({
        dataDir: env.dataDir,
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        platform: env.platform,
        version: env.version
      }),
      chooseFolder: () => env.chooseFolder(),
      openAccessibilitySettings: () => env.openAccessibilitySettings()
    }
  }
}
