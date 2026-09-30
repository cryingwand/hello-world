import { classesRepo } from './classes'
import { fileLinksRepo } from './fileLinks'
import { gradingRepo } from './grading'
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

export function createRepositories(db: Db, emit: Emit) {
  const deferred = createDeferredEmit(db, emit)
  emit = deferred.emit
  return {
    /** Runs `fn` atomically; change events are broadcast only after it commits. */
    transaction: deferred.transaction,
    terms: termsRepo(db, emit),
    students: studentsRepo(db, emit),
    classes: classesRepo(db, emit),
    grading: gradingRepo(db, emit),
    fileLinks: fileLinksRepo(db, emit),
    settings: settingsRepo(db, emit)
  }
}

export type Repositories = ReturnType<typeof createRepositories>
