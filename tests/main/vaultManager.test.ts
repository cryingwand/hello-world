import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VAULT_LOCKED_MESSAGE, type LockReason } from '@shared/vault'
import { openVaultDatabase } from '../../src/main/db/connection'
import { hashPasscode, passcodeProblem, verifyPasscode } from '../../src/main/vault/passcode'
import {
  VaultLockedError,
  createVaultManager,
  type TouchIdLike
} from '../../src/main/vault/manager'
import { ValidationError } from '../../src/main/validate'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-vault-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  vi.useRealTimers()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// Small parameters so the suite stays fast; the algorithm is the same.
const FAST = { N: 1 << 4, r: 8, p: 1, keylen: 32 }

describe('passcode hashing', () => {
  it('verifies the right passcode and rejects wrong ones', async () => {
    const rec = await hashPasscode('correct horse', FAST)
    expect(await verifyPasscode('correct horse', rec)).toBe(true)
    expect(await verifyPasscode('correct horsf', rec)).toBe(false)
    expect(await verifyPasscode('', rec)).toBe(false)
  })

  it('never stores the passcode, and salts every hash', async () => {
    const a = await hashPasscode('same passcode', FAST)
    const b = await hashPasscode('same passcode', FAST)
    expect(JSON.stringify(a)).not.toContain('same passcode')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it('treats equivalent unicode as the same passcode', async () => {
    const rec = await hashPasscode('café-pass', FAST) // precomposed é
    expect(await verifyPasscode('café-pass', rec)).toBe(true) // e + combining accent
  })

  it('never verifies a malformed or tampered record', async () => {
    const rec = await hashPasscode('correct horse', FAST)
    expect(await verifyPasscode('correct horse', { ...rec, hash: 'AAAA' })).toBe(false)
    expect(await verifyPasscode('correct horse', { ...rec, v: 2 as never })).toBe(false)
    expect(await verifyPasscode('correct horse', { ...rec, params: { ...rec.params, N: 3 } })).toBe(
      false
    )
    expect(await verifyPasscode('correct horse', {} as never)).toBe(false)
  })

  it('explains weak passcodes', () => {
    expect(passcodeProblem('abc')).toMatch(/at least 6/)
    expect(passcodeProblem('aaaaaaa')).toMatch(/repeated/)
    expect(passcodeProblem('x'.repeat(300))).toMatch(/too long/)
    expect(passcodeProblem(42)).toMatch(/Enter a passcode/)
    expect(passcodeProblem('good enough')).toBeNull()
  })
})

interface Session {
  db: Database.Database
}

function make(
  opts: {
    dir?: string
    touchId?: TouchIdLike
    now?: () => number
    afterOpen?: (db: Database.Database) => void
  } = {}
) {
  const dir = opts.dir ?? tmp()
  const locks: LockReason[] = []
  const statuses: boolean[] = []
  const mgr = createVaultManager<Session>({
    dir,
    openDb: openVaultDatabase,
    createSession: (db) => ({ db }),
    afterOpen: opts.afterOpen,
    onLock: (r) => locks.push(r),
    onStatusChange: (s) => statuses.push(s.locked),
    touchId: opts.touchId,
    scrypt: FAST,
    now: opts.now
  })
  return { mgr, dir, locks, statuses }
}

describe('vault lifecycle', () => {
  it('starts uninitialised and locked', () => {
    const { mgr } = make()
    expect(mgr.status()).toMatchObject({ initialized: false, locked: true, blockedForMs: 0 })
    expect(() => mgr.session()).toThrow(VaultLockedError)
  })

  it('setup chooses the passcode and unlocks; lock closes the database and drops the session', async () => {
    const { mgr, locks } = make()
    const st = await mgr.setup('first passcode')
    expect(st).toMatchObject({ initialized: true, locked: false })
    const db = mgr.session().db
    expect(db.open).toBe(true)
    db.prepare("INSERT INTO terms (name) VALUES ('T')").run()
    mgr.lock('manual')
    expect(db.open).toBe(false)
    expect(locks).toEqual(['manual'])
    expect(mgr.status().locked).toBe(true)
    expect(() => mgr.session()).toThrow(VaultLockedError)
    expect(() => mgr.database()).toThrow(VaultLockedError)
    expect(() => mgr.assertUnlocked()).toThrow(VAULT_LOCKED_MESSAGE)
  })

  it('a VaultLockedError is a user-facing error (its message reaches the window)', () => {
    expect(new VaultLockedError()).toBeInstanceOf(ValidationError)
  })

  it('unlock needs the right passcode, and data survives a lock and unlock', async () => {
    const { mgr } = make()
    await mgr.setup('first passcode')
    mgr.session().db.prepare("INSERT INTO terms (name) VALUES ('Kept')").run()
    mgr.lock('manual')
    await expect(mgr.unlock('nope nope')).rejects.toThrow('That passcode is not right.')
    expect(mgr.status().locked).toBe(true)
    await mgr.unlock('first passcode')
    expect(mgr.session().db.prepare('SELECT name FROM terms').get()).toEqual({ name: 'Kept' })
  })

  it('locking twice, or locking while locked, is harmless and reports once', async () => {
    const { mgr, locks } = make()
    await mgr.setup('first passcode')
    mgr.lock('manual')
    mgr.lock('idle')
    expect(locks).toEqual(['manual'])
  })

  it('refuses setup twice and unlock before setup', async () => {
    const { mgr } = make()
    await expect(mgr.unlock('whatever')).rejects.toThrow(/Choose a passcode first/)
    await mgr.setup('first passcode')
    await expect(mgr.setup('second passcode')).rejects.toThrow(/already set/)
  })

  it('refuses a weak passcode at setup', async () => {
    const { mgr } = make()
    await expect(mgr.setup('abc')).rejects.toThrow(/at least 6/)
    expect(mgr.status().initialized).toBe(false)
  })

  it('unlocking while already unlocked does nothing, and two unlocks at once open it once', async () => {
    let opens = 0
    const { mgr } = make({ afterOpen: () => void opens++ })
    await mgr.setup('first passcode')
    mgr.lock('manual')
    opens = 0
    await Promise.all([mgr.unlock('first passcode'), mgr.unlock('first passcode')])
    expect(opens).toBe(1)
    await mgr.unlock('first passcode')
    expect(opens).toBe(1)
  })

  it('a failure while opening leaves the vault locked, with the database closed', async () => {
    let db: Database.Database | null = null
    const { mgr } = make({
      afterOpen: (d) => {
        db = d
        throw new Error('import exploded')
      }
    })
    await expect(mgr.setup('first passcode')).rejects.toThrow(/could not be opened/)
    expect(mgr.status().locked).toBe(true)
    expect((db as unknown as Database.Database).open).toBe(false)
  })

  it('dispose locks', async () => {
    const { mgr, locks } = make()
    await mgr.setup('first passcode')
    mgr.dispose()
    expect(locks).toEqual(['quit'])
  })
})

describe('wrong-passcode throttling', () => {
  let clock = 1_000_000
  beforeEach(() => {
    clock = 1_000_000
  })
  const now = () => clock

  it('allows four free attempts, then blocks for 30 seconds, doubling each time up to a cap', async () => {
    const { mgr } = make({ now })
    await mgr.setup('first passcode')
    mgr.lock('manual')
    for (let i = 0; i < 4; i++) await expect(mgr.unlock('wrong one')).rejects.toThrow('not right')
    expect(mgr.status().blockedForMs).toBe(0)
    await expect(mgr.unlock('wrong one')).rejects.toThrow('not right') // the 5th
    expect(mgr.status().blockedForMs).toBe(30_000)
    await expect(mgr.unlock('first passcode')).rejects.toThrow(/Try again in 30 seconds/)
    clock += 30_001
    await expect(mgr.unlock('wrong one')).rejects.toThrow('not right') // 6th
    expect(mgr.status().blockedForMs).toBe(60_000)
    for (let i = 0; i < 12; i++) {
      clock += 15 * 60_000 + 1
      await expect(mgr.unlock('wrong one')).rejects.toThrow('not right')
    }
    expect(mgr.status().blockedForMs).toBe(15 * 60_000)
  })

  it('the correct passcode is also refused during a block, so guessing cannot simply continue', async () => {
    const { mgr } = make({ now })
    await mgr.setup('first passcode')
    mgr.lock('manual')
    for (let i = 0; i < 5; i++) await mgr.unlock('wrong one').catch(() => undefined)
    await expect(mgr.unlock('first passcode')).rejects.toThrow(/Too many wrong attempts/)
    expect(mgr.status().locked).toBe(true)
  })

  it('a correct passcode resets the count', async () => {
    const { mgr } = make({ now })
    await mgr.setup('first passcode')
    mgr.lock('manual')
    for (let i = 0; i < 3; i++) await mgr.unlock('wrong one').catch(() => undefined)
    await mgr.unlock('first passcode')
    mgr.lock('manual')
    for (let i = 0; i < 4; i++) await mgr.unlock('wrong one').catch(() => undefined)
    expect(mgr.status().blockedForMs).toBe(0) // would be blocked if the earlier 3 still counted
  })

  it('the throttle survives quitting and relaunching the app', async () => {
    const first = make({ now })
    await first.mgr.setup('first passcode')
    first.mgr.lock('manual')
    for (let i = 0; i < 5; i++) await first.mgr.unlock('wrong one').catch(() => undefined)
    const second = make({ dir: first.dir, now }) // a fresh process reading the same folder
    expect(second.mgr.status().blockedForMs).toBe(30_000)
    await expect(second.mgr.unlock('first passcode')).rejects.toThrow(/Too many wrong attempts/)
  })
})

describe('idle lock', () => {
  it('locks after the chosen idle time, and activity restarts the countdown', async () => {
    vi.useFakeTimers()
    const { mgr, locks } = make()
    await mgr.setup('first passcode')
    mgr.setAutoLock(5)
    vi.advanceTimersByTime(4 * 60_000)
    mgr.touch()
    vi.advanceTimersByTime(4 * 60_000)
    expect(mgr.isUnlocked()).toBe(true) // 8 minutes in, but touched at 4
    vi.advanceTimersByTime(60_001)
    expect(mgr.isUnlocked()).toBe(false)
    expect(locks).toEqual(['idle'])
  })

  it('"never" disables it, and a bad value is refused', async () => {
    vi.useFakeTimers()
    const { mgr } = make()
    await mgr.setup('first passcode')
    mgr.setAutoLock(0)
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(mgr.isUnlocked()).toBe(true)
    expect(() => mgr.setAutoLock(7)).toThrow(/listed times/)
    expect(() => mgr.setAutoLock('5' as never)).toThrow(/listed times/)
  })

  it('defaults to ten minutes and remembers the setting across a relaunch', async () => {
    const a = make()
    await a.mgr.setup('first passcode')
    expect(a.mgr.status().autoLockMinutes).toBe(10)
    a.mgr.setAutoLock(30)
    expect(make({ dir: a.dir }).mgr.status().autoLockMinutes).toBe(30)
  })

  it('locking cancels the pending timer', async () => {
    vi.useFakeTimers()
    const { mgr, locks } = make()
    await mgr.setup('first passcode')
    mgr.lock('manual')
    vi.advanceTimersByTime(60 * 60_000)
    expect(locks).toEqual(['manual'])
  })
})

describe('Vault backup folder', () => {
  it('is off by default, survives a relaunch and can be read while locked', async () => {
    const a = make()
    expect(a.mgr.backupFolder()).toBeNull()
    await a.mgr.setup('first passcode')
    expect(a.mgr.settings().backupFolder).toBeNull()
    a.mgr.setBackupFolder('/Volumes/USB/Vault')
    a.mgr.lock('manual')
    const again = make({ dir: a.dir })
    expect(again.mgr.status().locked).toBe(true)
    expect(again.mgr.backupFolder()).toBe('/Volumes/USB/Vault')
    again.mgr.setBackupFolder(null)
    expect(again.mgr.backupFolder()).toBeNull()
  })

  it('takes only an absolute path, and needs a passcode first', async () => {
    const a = make()
    expect(() => a.mgr.setBackupFolder('/Volumes/USB')).toThrow(/passcode first/)
    await a.mgr.setup('first passcode')
    for (const bad of ['relative/folder', '', 42, undefined])
      expect(() => a.mgr.setBackupFolder(bad)).toThrow(ValidationError)
    expect(a.mgr.backupFolder()).toBeNull()
  })

  it('reads a vault.json written before the setting existed as off', async () => {
    const a = make()
    await a.mgr.setup('first passcode')
    const meta = JSON.parse(readFileSync(a.mgr.paths.meta, 'utf8')) as Record<string, unknown>
    delete meta.backupFolder
    writeFileSync(a.mgr.paths.meta, JSON.stringify(meta))
    const again = make({ dir: a.dir })
    expect(again.mgr.status().initialized).toBe(true)
    expect(again.mgr.backupFolder()).toBeNull()
  })
})

describe('Touch ID', () => {
  const touch = (over: Partial<TouchIdLike> = {}): TouchIdLike & { prompts: string[] } => {
    const prompts: string[] = []
    return {
      prompts,
      available: () => true,
      prompt: async (reason) => void prompts.push(reason),
      ...over
    }
  }

  it('is off until turned on, and unlocking with it needs it on', async () => {
    const t = touch()
    const { mgr } = make({ touchId: t })
    await mgr.setup('first passcode')
    mgr.lock('manual')
    await expect(mgr.unlockWithTouchId()).rejects.toThrow(/not set up/)
    await mgr.unlock('first passcode')
    await mgr.setTouchId(true)
    mgr.lock('manual')
    expect((await mgr.unlockWithTouchId()).locked).toBe(false)
    expect(t.prompts).toHaveLength(2)
  })

  it('a failed Touch ID leaves the vault locked', async () => {
    const t = touch()
    const { mgr } = make({ touchId: t })
    await mgr.setup('first passcode', { touchId: true })
    mgr.lock('manual')
    t.prompt = () => Promise.reject(new Error('cancelled'))
    await expect(mgr.unlockWithTouchId()).rejects.toThrow(/did not unlock/)
    expect(mgr.status().locked).toBe(true)
  })

  it('cannot be turned on where unavailable, or when the prompt is refused', async () => {
    const { mgr } = make({ touchId: touch({ available: () => false }) })
    await mgr.setup('first passcode', { touchId: true })
    expect(mgr.status().touchId).toEqual({ available: false, enabled: false })
    await expect(mgr.setTouchId(true)).rejects.toThrow(/not available/)
    const b = make({ touchId: touch({ prompt: () => Promise.reject(new Error('no')) }) })
    await b.mgr.setup('first passcode')
    await expect(b.mgr.setTouchId(true)).rejects.toThrow(/not confirmed/)
    expect(b.mgr.status().touchId.enabled).toBe(false)
  })

  it('works without any Touch ID support object', async () => {
    const { mgr } = make()
    await mgr.setup('first passcode', { touchId: true })
    expect(mgr.status().touchId).toEqual({ available: false, enabled: false })
  })
})

describe('changing the passcode', () => {
  it('needs the current passcode, validates the new one, and the old one stops working', async () => {
    const { mgr } = make()
    await mgr.setup('first passcode')
    await expect(mgr.changePasscode('wrong one', 'second passcode')).rejects.toThrow('not right')
    await expect(mgr.changePasscode('first passcode', 'abc')).rejects.toThrow(/at least 6/)
    await mgr.changePasscode('first passcode', 'second passcode')
    mgr.lock('manual')
    await expect(mgr.unlock('first passcode')).rejects.toThrow('not right')
    await mgr.unlock('second passcode')
    expect(mgr.status().locked).toBe(false)
  })

  it('a wrong current passcode counts toward the throttle', async () => {
    const { mgr } = make()
    await mgr.setup('first passcode')
    for (let i = 0; i < 5; i++)
      await mgr.changePasscode('wrong one', 'second passcode').catch(() => undefined)
    expect(mgr.status().blockedForMs).toBeGreaterThan(0)
  })
})

describe('the passcode file', () => {
  it('holds a hash, not the passcode, with owner-only permissions', async () => {
    const { mgr, dir } = make()
    await mgr.setup('first passcode')
    const text = readFileSync(join(dir, 'vault.json'), 'utf8')
    expect(text).not.toContain('first passcode')
    expect(statSync(join(dir, 'vault.json')).mode & 0o077).toBe(0)
    expect(existsSync(join(dir, 'vault.json.tmp'))).toBe(false)
  })

  it('a missing or corrupt file means "choose a passcode", and existing data is kept', async () => {
    const a = make()
    await a.mgr.setup('first passcode')
    a.mgr.session().db.prepare("INSERT INTO terms (name) VALUES ('Precious')").run()
    a.mgr.lock('manual')
    for (const damage of ['not json', '{"v":1}', '']) {
      writeFileSync(join(a.dir, 'vault.json'), damage)
      const b = make({ dir: a.dir })
      expect(b.mgr.status().initialized, damage).toBe(false)
    }
    const recovered = make({ dir: a.dir })
    await recovered.mgr.setup('brand new passcode')
    expect(recovered.mgr.session().db.prepare('SELECT name FROM terms').get()).toEqual({
      name: 'Precious'
    })
  })

  it('reports whether a database file exists', async () => {
    const { mgr } = make()
    expect(mgr.hasDatabaseFile()).toBe(false)
    await mgr.setup('first passcode')
    expect(mgr.hasDatabaseFile()).toBe(true)
  })
})
