import type { ChangeName } from '@shared/events'
import type { DirectoryRepo, RosterSnapshot } from './repos/directory'
import type { Repositories } from './repos'

/** The Vault changes that can change a roster. */
export const ROSTER_EVENTS: readonly ChangeName[] = [
  'students.changed',
  'classes.changed',
  'enrollments.changed',
  'terms.changed'
]

/** Every class with its students, in the order the Vault lists them (current term first, then by name). */
export function rosterSnapshot(repos: Repositories): RosterSnapshot {
  const currentTerms = new Set(
    repos.terms
      .list()
      .filter((t) => t.isCurrent)
      .map((t) => t.id)
  )
  return {
    classes: repos.classes.list().map((c) => ({
      id: c.id,
      course: c.course,
      section: c.section,
      period: c.period,
      termName: c.termName,
      currentTerm: currentTerms.has(c.termId),
      // Names only: this is the whole of what leaves the Vault.
      students: repos.classes.roster(c.id).map((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        preferredName: s.preferredName
      }))
    }))
  }
}

/**
 * Keeps the everyday database's names-only roster copy in step with the Vault. It runs straight away
 * when a roster event fires (events only fire while the Vault is open, so there is never a closed
 * database to write behind) and once when the Vault opens, which also builds the first copy after an
 * upgrade. It must never throw: it runs while the Vault is opening and after the teacher's own saves, and
 * a failure here must not undo or block either. Errors are logged without any names in them.
 */
export function createRosterMirror(
  repos: Repositories,
  directory: DirectoryRepo,
  onError: (err: unknown) => void = (err) =>
    console.error(
      '[roster] could not update the roster copy:',
      err instanceof Error ? err.message : 'unknown error'
    )
) {
  const sync = (): boolean => {
    try {
      return directory.replace(rosterSnapshot(repos))
    } catch (err) {
      onError(err)
      return false
    }
  }
  return {
    sync,
    /** Pass every Vault change event through here. */
    handle(name: ChangeName): void {
      if (ROSTER_EVENTS.includes(name)) sync()
    }
  }
}

export type RosterMirror = ReturnType<typeof createRosterMirror>
