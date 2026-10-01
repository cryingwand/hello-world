import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { BackupInfo } from '@shared/models'
import type { Db } from './repos/types'

export const DEFAULT_KEEP_DAYS = 14
/** Past the daily window, the newest backup of each week is kept this long (about a semester). */
export const KEEP_WEEKS = 16
/** And the newest backup of each month this long. */
export const KEEP_MONTHS = 12

/** `data` backs up the public database, `vault` the vault. Names look like data-2026-09-30-091500.sqlite (local time). */
export type BackupPrefix = 'data' | 'vault'
const nameRe = (prefix: BackupPrefix): RegExp =>
  new RegExp(`^${prefix}-(\\d{4})-(\\d{2})-(\\d{2})-(\\d{2})(\\d{2})(\\d{2})\\.sqlite$`)

const pad = (n: number): string => String(n).padStart(2, '0')

export function backupFileName(d: Date, prefix: BackupPrefix = 'data'): string {
  return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.sqlite`
}

/** Parses the timestamp out of a backup file name, or null if it is not one of ours. */
export function parseBackupName(name: string, prefix: BackupPrefix = 'data'): Date | null {
  const m = nameRe(prefix).exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  return new Date(y, mo - 1, d, h, mi, s)
}

export function listBackups(dir: string, prefix: BackupPrefix = 'data'): BackupInfo[] {
  if (!existsSync(dir)) return []
  const out: BackupInfo[] = []
  for (const name of readdirSync(dir)) {
    const when = parseBackupName(name, prefix)
    if (!when) continue
    const path = join(dir, name)
    out.push({ name, path, size: statSync(path).size, createdAt: when.toISOString() })
  }
  return out.sort((a, b) => b.name.localeCompare(a.name))
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** The Monday that starts the local week of `d`, as a sortable key. */
const weekKey = (d: Date): string => {
  const day = startOfDay(d)
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}
const monthKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

/**
 * Which backups to keep: every backup from the last `keepDays` calendar days, then the newest one of
 * each week for `KEEP_WEEKS` weeks, then the newest one of each month for `KEEP_MONTHS` months. A
 * mistake noticed weeks later (a class deleted in October, found at grading time) can still be undone.
 */
export function backupsToKeep(
  backups: readonly { name: string; createdAt: string }[],
  now: Date,
  keepDays: number = DEFAULT_KEEP_DAYS
): Set<string> {
  const today = startOfDay(now)
  const dailyCutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays)
  const weeklyCutoff = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - KEEP_WEEKS * 7
  )
  const monthlyCutoff = new Date(today.getFullYear(), today.getMonth() - KEEP_MONTHS + 1, 1)
  const keep = new Set<string>()
  const weeks = new Set<string>()
  const months = new Set<string>()
  // Newest first, so the first backup seen in a week or month is the one kept for it.
  const sorted = [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  for (const b of sorted) {
    const when = new Date(b.createdAt)
    if (when >= dailyCutoff) {
      keep.add(b.name)
      continue
    }
    const week = weekKey(when)
    if (when >= weeklyCutoff && !weeks.has(week)) {
      weeks.add(week)
      keep.add(b.name)
    }
    const month = monthKey(when)
    if (when >= monthlyCutoff && !months.has(month)) {
      months.add(month)
      keep.add(b.name)
    }
  }
  return keep
}

/**
 * Deletes the backups `backupsToKeep` does not keep. Only files matching our naming pattern are
 * touched, so anything else the user keeps in the folder is safe. Returns what was removed.
 */
export function pruneBackups(
  dir: string,
  keepDays: number,
  now: Date,
  prefix: BackupPrefix = 'data'
): string[] {
  const all = listBackups(dir, prefix)
  const keep = backupsToKeep(all, now, keepDays)
  const removed: string[] = []
  for (const b of all) {
    if (!keep.has(b.name)) {
      rmSync(b.path, { force: true })
      removed.push(b.name)
    }
  }
  return removed
}

/**
 * Throws unless the file is a sound SQLite database. Opened read-write on purpose: a backup of a WAL
 * database is itself in WAL mode, and a read-only connection could not tidy up after itself.
 */
export function assertSoundDatabase(path: string): void {
  const check = new Database(path, { fileMustExist: true })
  try {
    const result = check.pragma('quick_check', { simple: true })
    if (result !== 'ok') throw new Error(`The backup failed its check: ${String(result)}`)
  } finally {
    check.close()
  }
}

/** True if no backup exists yet for the local calendar day of `now`. */
export function needsDailyBackup(dir: string, now: Date, prefix: BackupPrefix = 'data'): boolean {
  const today = `${prefix}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-`
  return !listBackups(dir, prefix).some((b) => b.name.startsWith(today))
}

export interface BackupOptions {
  dir: string
  /** Optional second location that also receives the backup. */
  extraDir?: string | null
  keepDays?: number
  now?: Date
  prefix?: BackupPrefix
}

/**
 * Takes a consistent online backup with SQLite's backup API (safe while the app is writing),
 * writes it under a temporary name, checks it, then renames it so a half-written or damaged file is
 * never mistaken for a good backup. A failure copying to the extra folder does not fail the backup.
 */
export async function runBackup(db: Db, opts: BackupOptions): Promise<BackupInfo> {
  const now = opts.now ?? new Date()
  const keepDays = opts.keepDays ?? DEFAULT_KEEP_DAYS
  mkdirSync(opts.dir, { recursive: true })

  const prefix = opts.prefix ?? 'data'
  const name = backupFileName(now, prefix)
  const finalPath = join(opts.dir, name)
  const tmpPath = `${finalPath}.partial`
  try {
    await db.backup(tmpPath)
    assertSoundDatabase(tmpPath)
    renameSync(tmpPath, finalPath)
  } catch (err) {
    for (const f of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) rmSync(f, { force: true })
    throw err
  }
  pruneBackups(opts.dir, keepDays, now, prefix)

  const info: BackupInfo = {
    name,
    path: finalPath,
    size: statSync(finalPath).size,
    createdAt: now.toISOString()
  }
  if (opts.extraDir) {
    try {
      mkdirSync(opts.extraDir, { recursive: true })
      copyFileSync(finalPath, join(opts.extraDir, name))
      pruneBackups(opts.extraDir, keepDays, now, prefix)
    } catch (err) {
      info.extraError = err instanceof Error ? err.message : String(err)
    }
  }
  return info
}
