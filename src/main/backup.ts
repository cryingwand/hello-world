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
import type { BackupInfo } from '@shared/models'
import type { Db } from './repos/types'

export const DEFAULT_KEEP_DAYS = 14

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

/**
 * Deletes backups older than `keepDays` calendar days. Only files matching our naming pattern are
 * touched, so anything else the user keeps in the folder is safe. Returns what was removed.
 */
export function pruneBackups(
  dir: string,
  keepDays: number,
  now: Date,
  prefix: BackupPrefix = 'data'
): string[] {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays).getTime()
  const removed: string[] = []
  for (const b of listBackups(dir, prefix)) {
    if (new Date(b.createdAt).getTime() < cutoff) {
      rmSync(b.path, { force: true })
      removed.push(b.name)
    }
  }
  return removed
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
 * writes it under a temporary name, then renames it so a half-written file is never mistaken
 * for a good backup. A failure copying to the extra folder does not fail the backup.
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
    renameSync(tmpPath, finalPath)
  } catch (err) {
    rmSync(tmpPath, { force: true })
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
