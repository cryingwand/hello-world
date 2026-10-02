import { describe, expect, it } from 'vitest'
import type { LockReason } from '@shared/vault'
import { lockReasonLine } from '@renderer/vault/lockReason'
import { studentDataOnScreen } from '@renderer/vault/studentData'

const at = (h: number, m: number, day = 2): number => new Date(2026, 9, day, h, m).getTime()
const NOW = new Date(2026, 9, 2, 12, 0)
const line = (reason: LockReason, minutes = 10, when = at(10, 42)): string =>
  lockReasonLine({ lastLock: { reason, at: when }, autoLockMinutes: minutes }, NOW, 'en-US')

describe('the lock screen reason line', () => {
  it('names the cause and the time', () => {
    expect(line('manual')).toBe('Locked at 10:42 AM by you.')
    expect(line('idle')).toBe('Locked at 10:42 AM after 10 minutes without activity.')
    expect(line('idle', 1)).toBe('Locked at 10:42 AM after 1 minute without activity.')
    expect(line('presenting')).toBe('Locked at 10:42 AM when a presentation started.')
    expect(line('display')).toBe('Locked at 10:42 AM when another display was connected.')
    expect(line('screen-lock')).toBe('Locked at 10:42 AM when the screen locked.')
    expect(line('sleep')).toBe('Locked at 10:42 AM when the Mac went to sleep.')
    expect(line('restore')).toBe('Locked at 10:42 AM to restore a backup.')
  })

  it('adds the weekday when the lock was not today', () => {
    expect(line('manual', 10, at(16, 5, 1))).toBe('Locked at Thu 4:05 PM by you.')
  })

  it('says so when it has not been locked since the app opened', () => {
    expect(lockReasonLine({ lastLock: null, autoLockMinutes: 10 })).toBe(
      'Locked since the app opened.'
    )
  })

  it('has a phrase for every reason', () => {
    const reasons: LockReason[] = [
      'manual',
      'idle',
      'presenting',
      'display',
      'screen-lock',
      'sleep',
      'quit',
      'restore'
    ]
    for (const r of reasons) expect(line(r)).toMatch(/^Locked at .+\.$/)
  })
})

describe('the Vault footer rule', () => {
  const apps = new Map([
    ['gradebook', { studentData: true }],
    ['quizzes', { studentData: false }],
    ['planner', {}]
  ])
  const win = (appId: string, minimized = false): { appId: string; minimized: boolean } => ({
    appId,
    minimized
  })

  it('is false with nothing open, or only apps that show no student data', () => {
    expect(studentDataOnScreen([], apps)).toBe(false)
    expect(studentDataOnScreen([win('quizzes'), win('planner')], apps)).toBe(false)
  })

  it('is true while any visible window shows student data', () => {
    expect(studentDataOnScreen([win('quizzes'), win('gradebook')], apps)).toBe(true)
  })

  it('ignores a minimized window and an app it does not know', () => {
    expect(studentDataOnScreen([win('gradebook', true)], apps)).toBe(false)
    expect(studentDataOnScreen([win('mystery')], apps)).toBe(false)
  })
})
