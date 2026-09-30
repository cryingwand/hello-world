import { classesRepo } from './classes'
import { fileLinksRepo } from './fileLinks'
import { gradingRepo } from './grading'
import { settingsRepo } from './settings'
import { studentsRepo } from './students'
import { termsRepo } from './terms'
import type { Db, Emit } from './types'

export type { Db, Emit } from './types'

export function createRepositories(db: Db, emit: Emit) {
  return {
    terms: termsRepo(db, emit),
    students: studentsRepo(db, emit),
    classes: classesRepo(db, emit),
    grading: gradingRepo(db, emit),
    fileLinks: fileLinksRepo(db, emit),
    settings: settingsRepo(db, emit)
  }
}

export type Repositories = ReturnType<typeof createRepositories>
