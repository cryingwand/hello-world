import { advisingRepo } from './advising'
import { classesRepo } from './classes'
import { deskRepo } from './desk'
import { directoryRepo } from './directory'
import { fileLinksRepo } from './fileLinks'
import { gradingRepo } from './grading'
import { plannerRepo } from './planner'
import { protectionRepo } from './protection'
import { questionsRepo } from './questions'
import { quizzesRepo } from './quizzes'
import { settingsRepo } from './settings'
import { studentsRepo } from './students'
import { termsRepo } from './terms'
import type { Db, Emit } from './types'

export type { Db, Emit } from './types'

/**
 * Wraps `emit` so events raised inside `transaction()` are held until the outermost transaction
 * commits (and dropped if it rolls back). Otherwise a window could refetch mid-transaction, read
 * the old snapshot, and never hear about the commit.
 */
export function createDeferredEmit(db: Db, emit: Emit) {
  let depth = 0
  let queue: Parameters<Emit>[] = []
  const wrapped: Emit = (name, detail) => {
    if (depth > 0) queue.push([name, detail])
    else emit(name, detail)
  }
  const transaction = <T>(fn: () => T): T => {
    depth++
    let result: T
    try {
      result = db.transaction(fn)()
    } catch (err) {
      depth--
      if (depth === 0) queue = []
      throw err
    }
    depth--
    if (depth === 0) {
      const seen = new Set<string>()
      const pending = queue
      queue = []
      for (const [name, detail] of pending) {
        const key = `${name}:${detail?.classId ?? ''}`
        if (!seen.has(key)) {
          seen.add(key)
          emit(name, detail)
        }
      }
    }
    return result
  }
  return { emit: wrapped, transaction }
}

/** Everything in the vault database. */
export function createVaultRepositories(db: Db, emit: Emit) {
  const deferred = createDeferredEmit(db, emit)
  emit = deferred.emit
  const grading = gradingRepo(db, emit)
  const planner = plannerRepo(db, emit)
  return {
    /** Runs `fn` atomically; change events are broadcast only after it commits. */
    transaction: deferred.transaction,
    terms: termsRepo(db, emit),
    students: studentsRepo(db, emit),
    classes: classesRepo(db, emit),
    advising: advisingRepo(db, emit),
    grading,
    questions: questionsRepo(db, emit),
    quizzes: quizzesRepo(db, emit, grading),
    units: planner.units,
    lessons: planner.lessons,
    fileLinks: fileLinksRepo(db, emit)
  }
}

/** Everything in the public database. */
export function createPublicRepositories(db: Db, emit: Emit) {
  return {
    settings: settingsRepo(db, emit),
    protection: protectionRepo(db, emit),
    directory: directoryRepo(db, emit),
    desk: deskRepo(db, emit)
  }
}

export type Repositories = ReturnType<typeof createVaultRepositories>
export type PublicRepositories = ReturnType<typeof createPublicRepositories>
