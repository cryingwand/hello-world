import { useSyncExternalStore } from 'react'
import { parseNames } from '@shared/tools'

/**
 * The names the teacher typed or pasted for the picker, the groups and the seating chart.
 *
 * Names are student information and the launcher is the window that is allowed on the projector, so
 * they live in this module's memory and nowhere else: never written to storage, never sent to the main
 * process, gone when the app quits. (A test keeps this folder free of storage and network calls.)
 * Closing and reopening the tools window keeps them; quitting does not.
 */
interface Snapshot {
  text: string
  names: string[]
  dropped: number
}

let snapshot: Snapshot = { text: '', names: [], dropped: 0 }
const listeners = new Set<() => void>()

export function setNamesText(text: string): void {
  const { names, dropped } = parseNames(text)
  snapshot = { text, names, dropped }
  for (const l of listeners) l()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useNames(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}
