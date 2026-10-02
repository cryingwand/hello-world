import type { AppManifest } from '@apps/types'

/** The Vault footer's two sentences. */
export const FOOTER_STUDENT_DATA = 'Student data on screen'
export const FOOTER_OPEN = 'Vault is open'
export const FOOTER_LOCKED = 'Vault is locked'

/**
 * Whether student data can be on screen: any window that is not minimized and belongs to an app
 * that shows it. A window panned off the canvas still counts, since a pan or Fit would bring it
 * back in one gesture.
 */
export function studentDataOnScreen(
  windows: ReadonlyArray<{ appId: string; minimized: boolean }>,
  apps: ReadonlyMap<string, Pick<AppManifest, 'studentData'>>
): boolean {
  return windows.some((w) => !w.minimized && apps.get(w.appId)?.studentData === true)
}
