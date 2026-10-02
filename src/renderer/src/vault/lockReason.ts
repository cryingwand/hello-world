import type { LockReason, VaultStatus } from '@shared/vault'

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

const PHRASE: Record<Exclude<LockReason, 'idle'>, string> = {
  manual: 'by you',
  presenting: 'when a presentation started',
  display: 'when another display was connected',
  'screen-lock': 'when the screen locked',
  sleep: 'when the Mac went to sleep',
  quit: 'when the app quit',
  restore: 'to restore a backup'
}

/**
 * The lock screen's reason line: what locked the Vault, and when. The lock is remembered in memory
 * only, so a Vault that has not been locked since the app opened says that instead.
 */
export function lockReasonLine(
  status: Pick<VaultStatus, 'lastLock' | 'autoLockMinutes'>,
  now: Date = new Date(),
  locale?: string
): string {
  const last = status.lastLock
  if (!last) return 'Locked since the app opened.'
  const at = new Date(last.at)
  const time = new Intl.DateTimeFormat(locale, {
    ...(sameDay(at, now) ? {} : { weekday: 'short' as const }),
    hour: 'numeric',
    minute: '2-digit'
  }).format(at)
  const minutes = status.autoLockMinutes
  const phrase =
    last.reason === 'idle'
      ? `after ${minutes} minute${minutes === 1 ? '' : 's'} without activity`
      : PHRASE[last.reason]
  return `Locked at ${time} ${phrase}.`
}
