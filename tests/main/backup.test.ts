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
import { VAULT_EXTRA_ERROR, createBackupService } from '../../src/main/backupService'
import { openVaultDatabase } from '../../src/main/db/connection'
import { createVaultGate } from '../../src/main/vault/gate'
import { legacyCopyName } from '../../src/main/vault/legacy'
import { createVaultManager } from '../../src/main/vault/manager'
import { makeEnv, makePublicEnv, seedClass } from './helpers'

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

describe('backup service: extra folders', () => {
  /** Wired as in `src/main/index.ts`: the public folder from settings, the Vault's from `vault.json`. */
  const setup = (now = at(2026, 9, 30)) => {
    const root = tmp()
    const pub = makePublicEnv()
    const manager = createVaultManager<object>({
      dir: join(root, 'vault'),
      openDb: openVaultDatabase,
      createSession: () => ({}),
      scrypt: { N: 1 << 4, r: 8, p: 1, keylen: 32 }
    })
    const gate = createVaultGate({
      manager,
      presenting: () => false,
      externalDisplays: () => 0,
      confirmExternalDisplay: async () => true
    })
    const clock = { now }
    const dir = join(root, 'backups')
    const svc = createBackupService({
      dir,
      publicDb: () => pub.db,
      vault: {
        open: () => (manager.isUnlocked() ? manager.database() : null),
        dbPath: manager.paths.db,
        extraDir: () => manager.backupFolder()
      },
      extraDir: () => pub.repos.settings.get().backupFolder,
      now: () => clock.now
    })
    return { root, dir, pub, manager, gate, svc, clock }
  }
  const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : [])

  it('never copies the Vault to the public extra folder, locked or open', async () => {
    const { root, pub, gate, svc, clock } = setup()
    await gate.setup('first passcode')
    gate.lock()
    // What the launcher can do without the passcode: choose a folder and back up now.
    const usb = join(root, 'usb')
    pub.repos.settings.update({ backupFolder: usb })
    const locked = await svc.runAll()
    expect(locked.vaultName).toBeDefined()
    expect(files(usb)).toEqual([locked.name])

    await gate.unlock('first passcode')
    clock.now = at(2026, 9, 30, 10)
    const open = await svc.runAll()
    expect(open.vaultName).toBeDefined()
    expect(files(usb).every((f) => f.startsWith('data-'))).toBe(true)
    expect(files(usb)).toHaveLength(2)
  })

  it('is off by default and copies Vault backups only to the folder chosen inside the Vault', async () => {
    const { root, dir, pub, gate, manager, svc } = setup()
    await gate.setup('first passcode')
    expect(gate.settings().backupFolder).toBeNull()
    const usb = join(root, 'usb')
    const vaultCopy = join(root, 'vault-usb')
    pub.repos.settings.update({ backupFolder: usb })
    expect((await gate.updateSettings({ backupFolder: vaultCopy })).backupFolder).toBe(vaultCopy)
    gate.lock()

    // The setting is read from vault.json, so it applies while locked.
    expect(manager.backupFolder()).toBe(vaultCopy)
    const info = await svc.runAll()
    expect(files(vaultCopy)).toEqual([info.vaultName])
    expect(files(usb)).toEqual([info.name])
    expect(files(dir)).toEqual([info.name, info.vaultName].sort())
  })

  it('stops copying the Vault when its folder is turned off', async () => {
    const { root, gate, svc, clock } = setup()
    await gate.setup('first passcode')
    const vaultCopy = join(root, 'vault-usb')
    await gate.updateSettings({ backupFolder: vaultCopy })
    await svc.runAll()
    await gate.updateSettings({ backupFolder: null })
    clock.now = at(2026, 9, 30, 11)
    await svc.runAll()
    expect(files(vaultCopy)).toHaveLength(1)
  })

  it('reports a failed Vault copy without naming its folder', async () => {
    const { root, gate, svc } = setup()
    await gate.setup('first passcode')
    const blocker = join(root, 'secret-place')
    writeFileSync(blocker, 'x') // a file where a folder is expected
    await gate.updateSettings({ backupFolder: join(blocker, 'sub') })
    const info = await svc.runAll()
    expect(info.vaultName).toBeDefined()
    expect(info.extraError).toBeUndefined()
    expect(info.vaultExtraError).toBe(VAULT_EXTRA_ERROR)
    expect(JSON.stringify(info)).not.toContain('secret-place')
  })

  it('lets vault copies an older version left in the public folder age out after 14 days', async () => {
    const { root, pub, svc } = setup(at(2026, 9, 30, 12))
    const usb = join(root, 'usb')
    mkdirSync(usb)
    const recent = backupFileName(at(2026, 9, 20), 'vault')
    const old = backupFileName(at(2026, 9, 1), 'vault')
    for (const n of [recent, old, 'notes.txt']) writeFileSync(join(usb, n), '')
    pub.repos.settings.update({ backupFolder: usb })
    const info = await svc.runAll()
    expect(files(usb)).toEqual([info.name, 'notes.txt', recent].sort())
  })

  it('prunes the pre-Vault copy of the old database like any other backup', async () => {
    const { dir, svc } = setup(at(2026, 9, 30, 12))
    mkdirSync(dir, { recursive: true })
    const recent = legacyCopyName(at(2026, 9, 20))
    const old = legacyCopyName(at(2026, 9, 1))
    for (const n of [recent, old, 'data-before-vault-notes.sqlite']) writeFileSync(join(dir, n), '')
    const info = await svc.runAll()
    expect(files(dir)).toEqual([info.name, 'data-before-vault-notes.sqlite', recent].sort())
  })
})
