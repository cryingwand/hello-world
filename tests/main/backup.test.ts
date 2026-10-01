import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  backupFileName,
  listBackups,
  needsDailyBackup,
  parseBackupName,
  pruneBackups,
  runBackup
} from '../../src/main/backup'
import { makeEnv, seedClass } from './helpers'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-backup-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const at = (y: number, mo: number, d: number, h = 9, mi = 0, s = 0): Date =>
  new Date(y, mo - 1, d, h, mi, s)

describe('backup file names', () => {
  it('round-trip through parse', () => {
    const d = at(2026, 9, 30, 9, 15, 42)
    expect(backupFileName(d)).toBe('data-2026-09-30-091542.sqlite')
    expect(parseBackupName(backupFileName(d))?.getTime()).toBe(d.getTime())
  })
  it('ignore files that are not ours', () => {
    expect(parseBackupName('notes.txt')).toBeNull()
    expect(parseBackupName('data-2026-09-30-091542.sqlite.partial')).toBeNull()
  })
})

describe('runBackup', () => {
  it('writes a complete, openable copy containing the data', async () => {
    const env = makeEnv()
    seedClass(env, 2)
    const dir = tmp()
    const info = await runBackup(env.db, { dir, now: at(2026, 9, 30) })
    expect(existsSync(info.path)).toBe(true)
    expect(readdirSync(dir).some((f) => f.endsWith('.partial'))).toBe(false)
    const copy = new Database(info.path, { readonly: true })
    expect((copy.prepare('SELECT COUNT(*) n FROM students').get() as { n: number }).n).toBe(2)
    copy.close()
  })

  it('copies to the extra folder and prunes both', async () => {
    const env = makeEnv()
    const dir = tmp()
    const extra = join(tmp(), 'nested', 'usb')
    const old = at(2026, 9, 1)
    await runBackup(env.db, { dir, extraDir: extra, now: old })
    const info = await runBackup(env.db, { dir, extraDir: extra, now: at(2026, 9, 30) })
    expect(info.extraError).toBeUndefined()
    expect(listBackups(dir).map((b) => b.name)).toEqual([backupFileName(at(2026, 9, 30))])
    expect(listBackups(extra).map((b) => b.name)).toEqual([backupFileName(at(2026, 9, 30))])
  })

  it('still succeeds, and reports it, when the extra folder cannot be written', async () => {
    const env = makeEnv()
    const dir = tmp()
    const blocker = join(tmp(), 'file')
    writeFileSync(blocker, 'x') // a file where a folder is expected
    const info = await runBackup(env.db, {
      dir,
      extraDir: join(blocker, 'sub'),
      now: at(2026, 9, 30)
    })
    expect(existsSync(info.path)).toBe(true)
    expect(info.extraError).toBeTruthy()
  })

  it('leaves no partial file when the backup fails', async () => {
    const env = makeEnv()
    const dir = tmp()
    env.db.close()
    await expect(runBackup(env.db, { dir, now: at(2026, 9, 30) })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('pruneBackups', () => {
  it('keeps 14 days, removes older, and never touches unrelated files', () => {
    const dir = tmp()
    const now = at(2026, 9, 30, 12)
    const names = [
      backupFileName(at(2026, 9, 30)), // today
      backupFileName(at(2026, 9, 16, 0, 0, 1)), // 14 days ago: kept
      backupFileName(at(2026, 9, 15, 23)), // 15 days ago: removed
      backupFileName(at(2026, 8, 1))
    ]
    for (const n of names) writeFileSync(join(dir, n), '')
    writeFileSync(join(dir, 'my-notes.txt'), '')
    mkdirSync(join(dir, 'data-subfolder'))
    const removed = pruneBackups(dir, 14, now)
    expect(removed.sort()).toEqual([names[2], names[3]].sort())
    expect(readdirSync(dir).sort()).toEqual(
      [names[0], names[1], 'data-subfolder', 'my-notes.txt'].sort()
    )
  })
})

describe('needsDailyBackup', () => {
  it('is true until a backup exists for the local day', () => {
    const dir = tmp()
    const now = at(2026, 9, 30, 15)
    expect(needsDailyBackup(dir, now)).toBe(true)
    writeFileSync(join(dir, backupFileName(at(2026, 9, 29, 23, 59, 59))), '')
    expect(needsDailyBackup(dir, now)).toBe(true)
    writeFileSync(join(dir, backupFileName(at(2026, 9, 30, 0, 0, 1))), '')
    expect(needsDailyBackup(dir, now)).toBe(false)
  })
  it('handles a missing folder', () => {
    expect(needsDailyBackup(join(tmp(), 'nope'), new Date())).toBe(true)
    expect(listBackups(join(tmp(), 'nope'))).toEqual([])
  })
})
