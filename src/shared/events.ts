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
  'settings.changed'
] as const

export type ChangeName = (typeof CHANGE_NAMES)[number]

export interface ChangeEvent {
  name: ChangeName
  /** Present when the change is scoped to one class, so other classes need not refetch. */
  classId?: number
}

export const CHANGE_CHANNEL = 'teachingos:change'

/** Main asks the window to flip presentation mode (from the View menu or its hotkey). */
export const PRESENTATION_TOGGLE_CHANNEL = 'teachingos:presentation-toggle'
/** Main tells the window an external display appeared, so it can offer presentation mode. */
export const DISPLAY_OFFER_CHANNEL = 'teachingos:display-offer'

export interface DisplayOffer {
  reason: 'connected' | 'already-connected'
}
