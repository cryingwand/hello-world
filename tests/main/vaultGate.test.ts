import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackupService } from '../../src/main/backupService'
import { openPublicDatabase, openVaultDatabase } from '../../src/main/db/connection'
import { createVaultGate } from '../../src/main/vault/gate'
import { createVaultManager } from '../../src/main/vault/manager'
import { ValidationError } from '../../src/main/validate'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-gate-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const FAST = { N: 1 << 4, r: 8, p: 1, keylen: 32 }

function make(state: { presenting?: boolean; displays?: number; confirm?: boolean } = {}) {
  const dir = tmp()
  const s = { presenting: false, displays: 0, confirm: true, asked: 0, ...state }
  const manager = createVaultManager<{ db: Database.Database }>({
    dir,
    openDb: openVaultDatabase,
    createSession: (db) => ({ db }),
    scrypt: FAST
  })
  const gate = createVaultGate({
    manager,
    presenting: () => s.presenting,
    externalDisplays: () => s.displays,
    confirmExternalDisplay: async () => {
      s.asked++
      return s.confirm
    }
  })
  return { dir, manager, gate, s }
}

describe('vault gate', () => {
  it('sets up and unlocks normally when nothing is presenting or connected', async () => {
    const { gate, manager, s } = make()
    expect((await gate.setup('first passcode')).locked).toBe(false)
    gate.lock()
    expect(manager.isUnlocked()).toBe(false)
    expect((await gate.unlock('first passcode')).locked).toBe(false)
    expect(s.asked).toBe(0)
  })

  it('refuses every way of opening while a presentation is running, without touching the passcode', async () => {
    const { gate, manager, s } = make()
    await gate.setup('first passcode')
    gate.lock()
    s.presenting = true
    await expect(gate.unlock('first passcode')).rejects.toThrow(/End the presentation/)
    await expect(gate.unlock('wrong wrong')).rejects.toThrow(/End the presentation/)
    await expect(gate.unlockWithTouchId()).rejects.toThrow(/End the presentation/)
    await expect(gate.setup('another pass')).rejects.toBeInstanceOf(ValidationError)
    expect(manager.isUnlocked()).toBe(false)
    // A refused attempt while presenting must not count as a failed passcode.
    expect(manager.status().blockedForMs).toBe(0)
    s.presenting = false
    expect((await gate.unlock('first passcode')).locked).toBe(false)
  })

  it('locks again if a presentation started while the passcode was being checked', async () => {
    const dir = tmp()
    const manager = createVaultManager<object>({
      dir,
      openDb: openVaultDatabase,
      createSession: () => ({}),
      scrypt: FAST
    })
    let calls = 0
    // Not presenting when the unlock begins, presenting by the time the passcode check finishes.
    const gate = createVaultGate({
      manager,
      presenting: () => ++calls > 1,
      externalDisplays: () => 0,
      confirmExternalDisplay: async () => true
    })
    await expect(gate.setup('first passcode')).rejects.toThrow(/End the presentation/)
    expect(manager.isUnlocked()).toBe(false)
  })

  it('asks first when another display is connected, and relocks if the answer is no', async () => {
    const { gate, manager, s } = make()
    await gate.setup('first passcode')
    gate.lock()
    s.displays = 1
    s.confirm = false
    await expect(gate.unlock('first passcode')).rejects.toThrow(/stays locked/)
    expect(manager.isUnlocked()).toBe(false)
    expect(s.asked).toBe(1)
    s.confirm = true
    expect((await gate.unlock('first passcode')).locked).toBe(false)
    expect(s.asked).toBe(2)
  })

  it('treats a failing confirmation as no', async () => {
    const dir = tmp()
    const manager = createVaultManager<object>({
      dir,
      openDb: openVaultDatabase,
      createSession: () => ({}),
      scrypt: FAST
    })
    const gate = createVaultGate({
      manager,
      presenting: () => false,
      externalDisplays: () => 2,
      confirmExternalDisplay: () => Promise.reject(new Error('dialog failed'))
    })
    await expect(gate.setup('first passcode')).rejects.toThrow(/stays locked/)
    expect(manager.isUnlocked()).toBe(false)
  })

  it('updates settings through the manager and rejects bad values', async () => {
    const { gate } = make()
    await gate.setup('first passcode')
    expect((await gate.updateSettings({ autoLockMinutes: 5 })).autoLockMinutes).toBe(5)
    await expect(gate.updateSettings({ autoLockMinutes: 7 })).rejects.toBeInstanceOf(
      ValidationError
    )
    expect(gate.settings().autoLockMinutes).toBe(5)
  })

  it('changes the passcode only with the current one', async () => {
    const { gate } = make()
    await gate.setup('first passcode')
    await expect(gate.changePasscode('wrong wrong', 'second passcode')).rejects.toThrow(/not right/)
    await gate.changePasscode('first passcode', 'second passcode')
    gate.lock()
    await expect(gate.unlock('first passcode')).rejects.toThrow(/not right/)
    expect((await gate.unlock('second passcode')).locked).toBe(false)
  })
})

describe('backup service', () => {
  const setup = () => {
    const dir = tmp()
    const vaultPath = join(dir, 'vault', 'vault.sqlite')
    const publicDb = openPublicDatabase(':memory:')
    let open: Database.Database | null = null
    const svc = createBackupService({
      dir: join(dir, 'backups'),
      publicDb: () => publicDb,
      vault: { open: () => open, dbPath: vaultPath },
      extraDir: () => null,
      now: () => new Date(2026, 8, 30, 9, 0, 0)
    })
    return {
      dir,
      vaultPath,
      svc,
      setOpen: (db: Database.Database | null) => (open = db)
    }
  }

  it('backs up only the public database when no vault exists yet', async () => {
    const { svc, dir } = setup()
    const info = await svc.runAll()
    expect(info.vaultName).toBeUndefined()
    expect(readdirSync(join(dir, 'backups')).filter((f) => f.startsWith('vault-'))).toEqual([])
    expect(svc.list()).toHaveLength(1)
  })

  it('backs up a locked vault from its file, and an open one from its connection', async () => {
    const { svc, dir, vaultPath, setOpen } = setup()
    const v = openVaultDatabase(vaultPath)
    v.prepare("INSERT INTO terms (name) VALUES ('Keep')").run()
    v.close() // locked: nothing is open
    const locked = await svc.runAll()
    expect(locked.vaultName).toMatch(/^vault-2026-09-30-090000\.sqlite$/)

    const live = openVaultDatabase(vaultPath)
    live.prepare("INSERT INTO terms (name) VALUES ('Two')").run()
    setOpen(live)
    const again = await svc.runAll()
    expect(again.vaultName).toBeDefined()
    live.close()
    const copy = new Database(join(dir, 'backups', again.vaultName!), { readonly: true })
    expect((copy.prepare('SELECT COUNT(*) n FROM terms').get() as { n: number }).n).toBe(2)
    copy.close()
    expect(svc.listVault().length).toBeGreaterThan(0)
  })

  it('reports a vault problem without losing the public backup', async () => {
    const { svc, vaultPath } = setup()
    // A file that is not a database makes the vault backup fail.
    mkdirSync(join(vaultPath, '..'), { recursive: true })
    writeFileSync(vaultPath, 'this is not sqlite')
    const info = await svc.runAll()
    expect(existsSync(info.path)).toBe(true)
    expect(info.vaultError).toBeTruthy()
    expect(info.vaultName).toBeUndefined()
  })

  it('asks for a daily backup when either database lacks one today', async () => {
    const { svc, vaultPath } = setup()
    expect(svc.needsDaily()).toBe(true)
    await svc.runAll()
    expect(svc.needsDaily()).toBe(false)
    openVaultDatabase(vaultPath).close()
    expect(svc.needsDaily()).toBe(true)
  })
})
