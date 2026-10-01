import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  AUTO_LOCK_CHOICES,
  DEFAULT_AUTO_LOCK_MINUTES,
  VAULT_LOCKED_MESSAGE,
  type LockReason,
  type VaultSettings,
  type VaultStatus
} from '@shared/vault'
import type { Db } from '../repos/types'
import { ValidationError, reqStr } from '../validate'
import {
  DEFAULT_SCRYPT,
  hashPasscode,
  passcodeProblem,
  verifyPasscode,
  type PasscodeRecord,
  type ScryptParams
} from './passcode'

/** Thrown for any vault call made while it is locked. The message is shown to the user as is. */
export class VaultLockedError extends ValidationError {
  constructor() {
    super(VAULT_LOCKED_MESSAGE)
    this.name = 'VaultLockedError'
  }
}

export interface TouchIdLike {
  available(): boolean
  /** Resolves if the person authenticated; rejects otherwise. */
  prompt(reason: string): Promise<void>
}

export interface VaultManagerDeps<S> {
  /** Folder holding `vault.sqlite` and `vault.json`. */
  dir: string
  openDb: (path: string) => Db
  /** Builds everything that works on an open vault database. Dropped when the vault locks. */
  createSession: (db: Db) => S
  /** Runs right after the database opens, for example to import data from an older version. */
  afterOpen?: (db: Db) => void
  onLock?: (reason: LockReason) => void
  onStatusChange?: (status: VaultStatus) => void
  touchId?: TouchIdLike
  scrypt?: ScryptParams
  now?: () => number
}

interface Meta {
  v: 1
  passcode: PasscodeRecord
  touchId: boolean
  autoLockMinutes: number
  failures: number
  blockedUntil: number
  /** Extra folder for Vault backups. Missing in files written before it existed: off. */
  backupFolder?: string | null
}

const FREE_ATTEMPTS = 4
const BASE_BLOCK_MS = 30_000
const MAX_BLOCK_MS = 15 * 60_000

const isMeta = (m: unknown): m is Meta => {
  const x = m as Meta | null
  return (
    !!x &&
    x.v === 1 &&
    !!x.passcode &&
    typeof x.passcode.hash === 'string' &&
    typeof x.passcode.salt === 'string' &&
    typeof x.passcode.params?.N === 'number' &&
    typeof x.touchId === 'boolean' &&
    typeof x.autoLockMinutes === 'number' &&
    Number.isFinite(x.failures) &&
    Number.isFinite(x.blockedUntil) &&
    (x.backupFolder === undefined || x.backupFolder === null || typeof x.backupFolder === 'string')
  )
}

/**
 * Owns the vault's lifecycle. Locked means the database is closed and nothing built on it exists, so
 * there is nothing in memory to leak. Wrong passcodes are throttled, and the throttle is stored on
 * disk so restarting the app does not reset it.
 *
 * The passcode gates access through the app. It does not encrypt `vault.sqlite`, so someone with
 * access to the files can still read them; FileVault protects the disk.
 */
export function createVaultManager<S>(deps: VaultManagerDeps<S>) {
  const dbPath = join(deps.dir, 'vault.sqlite')
  const metaPath = join(deps.dir, 'vault.json')
  const now = deps.now ?? Date.now
  const scryptParams = deps.scrypt ?? DEFAULT_SCRYPT

  let meta: Meta | null = null
  let metaLoaded = false
  let open: { db: Db; value: S } | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let opening: Promise<void> | null = null

  const readMeta = (): Meta | null => {
    if (!metaLoaded) {
      metaLoaded = true
      try {
        const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as unknown
        meta = isMeta(parsed) ? parsed : null
      } catch {
        meta = null // missing or unreadable: treated as "no passcode chosen yet"
      }
    }
    return meta
  }

  const writeMeta = (next: Meta): void => {
    mkdirSync(deps.dir, { recursive: true, mode: 0o700 })
    const tmp = `${metaPath}.tmp`
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 })
    renameSync(tmp, metaPath)
    try {
      chmodSync(metaPath, 0o600)
    } catch {
      // Not every filesystem supports modes; the file is still in a folder only this user can read.
    }
    meta = next
    metaLoaded = true
  }

  const touchId = (): TouchIdLike =>
    deps.touchId ?? {
      available: () => false,
      prompt: () => Promise.reject(new Error('unavailable'))
    }

  const status = (): VaultStatus => {
    const m = readMeta()
    return {
      initialized: m !== null,
      locked: open === null,
      touchId: { available: touchId().available(), enabled: !!m?.touchId },
      blockedForMs: m ? Math.max(0, m.blockedUntil - now()) : 0,
      autoLockMinutes: m?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES
    }
  }
  const announce = (): void => deps.onStatusChange?.(status())

  const clearTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }
  const armTimer = (): void => {
    clearTimer()
    const minutes = readMeta()?.autoLockMinutes ?? 0
    if (!open || minutes <= 0) return
    idleTimer = setTimeout(() => lock('idle'), minutes * 60_000)
    idleTimer.unref?.()
  }

  function lock(reason: LockReason): void {
    clearTimer()
    if (!open) return
    const closing = open
    open = null // refuse new calls before anything else happens
    try {
      closing.db.close()
    } catch (err) {
      console.error('[vault] closing the database failed:', err)
    }
    deps.onLock?.(reason)
    announce()
  }

  const openNow = (): void => {
    if (open) return
    const db = deps.openDb(dbPath)
    try {
      deps.afterOpen?.(db)
      open = { db, value: deps.createSession(db) }
    } catch (err) {
      try {
        db.close()
      } catch {
        // already closed
      }
      console.error('[vault] opening failed:', err)
      throw err instanceof ValidationError
        ? err
        : new Error('The Vault could not be opened.', { cause: err })
    }
    armTimer()
    announce()
  }

  /** Counts a wrong passcode and starts a growing pause after the first few. */
  const recordFailure = (m: Meta): void => {
    const failures = m.failures + 1
    const over = failures - FREE_ATTEMPTS
    const blockedUntil =
      over > 0 ? now() + Math.min(BASE_BLOCK_MS * 2 ** (over - 1), MAX_BLOCK_MS) : 0
    writeMeta({ ...m, failures, blockedUntil })
  }

  const requireNotBlocked = (m: Meta): void => {
    const wait = m.blockedUntil - now()
    if (wait > 0) {
      throw new ValidationError(
        `Too many wrong attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`
      )
    }
  }

  /** Verifies a passcode with throttling. Throws if it is wrong. */
  const checkPasscode = async (passcode: unknown, m: Meta): Promise<void> => {
    requireNotBlocked(m)
    const ok = typeof passcode === 'string' && (await verifyPasscode(passcode, m.passcode))
    if (!ok) {
      recordFailure(m)
      announce()
      throw new ValidationError('That passcode is not right.')
    }
    if (m.failures !== 0 || m.blockedUntil !== 0) writeMeta({ ...m, failures: 0, blockedUntil: 0 })
  }

  const serialised = async (fn: () => Promise<void>): Promise<void> => {
    while (opening) await opening.catch(() => undefined)
    opening = fn()
    try {
      await opening
    } finally {
      opening = null
    }
  }

  return {
    status,

    /** First run: choose the passcode. Also the recovery path after `vault.json` is removed. */
    async setup(passcode: unknown, options: { touchId?: boolean } = {}): Promise<VaultStatus> {
      await serialised(async () => {
        if (readMeta()) throw new ValidationError('A passcode is already set.')
        const problem = passcodeProblem(passcode)
        if (problem) throw new ValidationError(problem)
        const record = await hashPasscode(passcode as string, scryptParams)
        const enableTouch = !!options.touchId && touchId().available()
        writeMeta({
          v: 1,
          passcode: record,
          touchId: enableTouch,
          autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
          failures: 0,
          blockedUntil: 0
        })
        openNow()
      })
      return status()
    },

    async unlock(passcode: unknown): Promise<VaultStatus> {
      await serialised(async () => {
        const m = readMeta()
        if (!m) throw new ValidationError('Choose a passcode first.')
        if (open) return
        await checkPasscode(passcode, m)
        openNow()
      })
      return status()
    },

    async unlockWithTouchId(): Promise<VaultStatus> {
      await serialised(async () => {
        const m = readMeta()
        if (!m) throw new ValidationError('Choose a passcode first.')
        if (open) return
        if (!m.touchId || !touchId().available())
          throw new ValidationError('Touch ID is not set up for the Vault.')
        try {
          await touchId().prompt('Unlock the Teaching OS Vault')
        } catch {
          throw new ValidationError('Touch ID did not unlock the Vault.')
        }
        openNow()
      })
      return status()
    },

    lock,
    isUnlocked: (): boolean => open !== null,

    assertUnlocked(): void {
      if (!open) throw new VaultLockedError()
    },

    /** The objects built on the open database. Throws while locked. */
    session(): S {
      if (!open) throw new VaultLockedError()
      return open.value
    },

    /** The open database, for backups. Throws while locked. */
    database(): Db {
      if (!open) throw new VaultLockedError()
      return open.db
    },

    /** Real activity (a click or key press) restarts the idle countdown. */
    touch(): void {
      if (open) armTimer()
    },

    settings(): VaultSettings {
      const s = status()
      return {
        autoLockMinutes: s.autoLockMinutes,
        touchIdAvailable: s.touchId.available,
        touchIdEnabled: s.touchId.enabled,
        backupFolder: readMeta()?.backupFolder ?? null
      }
    },

    async changePasscode(current: unknown, next: unknown): Promise<void> {
      const m = readMeta()
      if (!m) throw new ValidationError('Choose a passcode first.')
      await checkPasscode(current, m)
      const problem = passcodeProblem(next)
      if (problem) throw new ValidationError(problem)
      const record = await hashPasscode(next as string, scryptParams)
      writeMeta({ ...(readMeta() as Meta), passcode: record, failures: 0, blockedUntil: 0 })
    },

    async setTouchId(enabled: boolean): Promise<void> {
      const m = readMeta()
      if (!m) throw new ValidationError('Choose a passcode first.')
      if (enabled) {
        if (!touchId().available())
          throw new ValidationError('Touch ID is not available on this Mac.')
        try {
          await touchId().prompt('Turn on Touch ID for the Teaching OS Vault')
        } catch {
          throw new ValidationError('Touch ID was not confirmed, so it stays off.')
        }
      }
      writeMeta({ ...m, touchId: enabled })
      announce()
    },

    setAutoLock(minutes: unknown): void {
      const m = readMeta()
      if (!m) throw new ValidationError('Choose a passcode first.')
      if (
        typeof minutes !== 'number' ||
        !(AUTO_LOCK_CHOICES as readonly number[]).includes(minutes)
      ) {
        throw new ValidationError('Choose one of the listed times.')
      }
      writeMeta({ ...m, autoLockMinutes: minutes })
      armTimer()
      announce()
    },

    /**
     * The folder that also receives Vault backups, or null. Readable while locked, because backups
     * run then too; only `setBackupFolder` (an unlocked-Vault call) changes it.
     */
    backupFolder: (): string | null => readMeta()?.backupFolder ?? null,

    setBackupFolder(folder: unknown): void {
      const m = readMeta()
      if (!m) throw new ValidationError('Choose a passcode first.')
      let clean: string | null = null
      if (folder !== null) {
        clean = reqStr(folder, 'Backup folder', 1024)
        if (!isAbsolute(clean)) throw new ValidationError('Backup folder must be an absolute path')
      }
      writeMeta({ ...m, backupFolder: clean })
    },

    /** True if a vault database file exists, whether or not a passcode has been chosen. */
    hasDatabaseFile: (): boolean => existsSync(dbPath),
    paths: { db: dbPath, meta: metaPath },

    dispose(): void {
      lock('quit')
      clearTimer()
    }
  }
}

export type VaultManager<S> = ReturnType<typeof createVaultManager<S>>
