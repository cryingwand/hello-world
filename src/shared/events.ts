/** Broadcast by the main process after data changes so every open window can refetch. */
export const CHANGE_NAMES = [
  'terms.changed',
  'students.changed',
  'classes.changed',
  'enrollments.changed',
  'categories.changed',
  'assignments.changed',
  'scores.changed',
  'fileLinks.changed',
  'advising.changed',
  'questions.changed',
  'quizzes.changed',
  'planner.changed',
  'settings.changed',
  'protection.changed',
  'directory.changed',
  'folders.changed',
  'desk.changed',
  'calendar.changed',
  'updates.changed'
] as const

export type ChangeName = (typeof CHANGE_NAMES)[number]

export interface ChangeEvent {
  name: ChangeName
  /** Present when the change is scoped to one class, so other classes need not refetch. */
  classId?: number
}

export const CHANGE_CHANNEL = 'teachingos:change'

/** Main tells the Presenter an external display appeared, so it can offer the Stage. */
export const DISPLAY_OFFER_CHANNEL = 'teachingos:display-offer'

export interface DisplayOffer {
  reason: 'connected' | 'already-connected'
}

/**
 * Which window roles hear each change. Student and gradebook changes go to the vault only, so a
 * window outside the vault never even learns that vault data changed.
 */
export const CHANGE_AUDIENCE: Record<ChangeName, readonly ('launcher' | 'vault' | 'stage')[]> = {
  'terms.changed': ['vault'],
  'students.changed': ['vault'],
  'classes.changed': ['vault'],
  'enrollments.changed': ['vault'],
  'categories.changed': ['vault'],
  'assignments.changed': ['vault'],
  'scores.changed': ['vault'],
  'fileLinks.changed': ['vault'],
  'advising.changed': ['vault'],
  'questions.changed': ['vault'],
  'quizzes.changed': ['vault'],
  'planner.changed': ['vault'],
  'settings.changed': ['launcher', 'vault'],
  // Which folders are protected is itself not shown outside the vault.
  'protection.changed': ['vault'],
  // The names-only roster copy is for the everyday window; the Vault has the real thing.
  'directory.changed': ['launcher'],
  // Something changed in a folder on the Mac. No path travels with it.
  'folders.changed': ['launcher', 'vault'],
  // The everyday desktop's pinned files and areas exist only in the everyday window.
  'desk.changed': ['launcher'],
  'calendar.changed': ['launcher', 'vault'],
  // An update was found, or one is downloading. Only the everyday window's Settings shows them.
  'updates.changed': ['launcher']
}
