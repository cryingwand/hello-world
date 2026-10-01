import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { keepCutoff } from '../backup'
import type { Db } from '../repos/types'

/** In dependency order: a row's parents are copied before it. */
export const VAULT_TABLES = [
  'terms',
  'students',
  'classes',
  'enrollments',
  'grade_categories',
  'assignments',
  'scores',
  'file_links'
] as const

const tableExists = (db: Db, name: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)

/** Every row, in a stable order, as a fingerprint that catches any difference in any column. */
const fingerprint = (rows: unknown[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex')

const readAll = (db: Db, table: string): unknown[] =>
  db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()

/**
 * The full copy of the old database saved before an import, e.g.
 * `data-before-vault-2026-09-30T10-00-00-000Z.sqlite` (UTC). It holds every student and grade from
 * before the Vault, so it is pruned like any other backup (`pruneLegacyCopies`) rather than kept.
 */
export const legacyCopyName = (d: Date): string =>
  `data-before-vault-${d.toISOString().replace(/[:.]/g, '-')}.sqlite`

const LEGACY_COPY_RE =
  /^data-before-vault-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sqlite$/

/** The time a legacy copy was made, from its name, or null if the name is not one of ours. */
export function parseLegacyCopyName(name: string): Date | null {
  const m = LEGACY_COPY_RE.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s, ms] = m.map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms))
}

/**
 * Deletes legacy copies older than `keepDays` calendar days, by the same rule as `pruneBackups`.
 * Only files with our naming pattern are touched. Returns what was removed.
 */
export function pruneLegacyCopies(dir: string, keepDays: number, now: Date): string[] {
  if (!existsSync(dir)) return []
  const cutoff = keepCutoff(now, keepDays)
  const removed: string[] = []
  for (const name of readdirSync(dir)) {
    const when = parseLegacyCopyName(name)
    if (when && when.getTime() < cutoff) {
      rmSync(join(dir, name), { force: true })
      removed.push(name)
    }
  }
  return removed
}

export interface LegacyOptions {
  /** Where to keep a full copy of the old database before anything is changed. */
  backupDir?: string
  now?: () => Date
}

export interface LegacyResult {
  /** Rows moved, per table. */
  imported: Record<string, number>
  /** The vault already held an identical copy (an earlier run was interrupted), so only cleanup ran. */
  alreadyImported: boolean
  backupPath: string | null
}

/**
 * Before the vault existed, students, classes and grades lived in `data.sqlite`. This moves them into
 * the vault database. It never deletes the old copy until the new one is proven identical:
 *
 * 1. a full copy of the old database is saved;
 * 2. rows are copied inside one transaction, with their ids, so nothing that refers to them breaks;
 * 3. every table is fingerprinted on both sides and compared;
 * 4. only then are the old tables dropped from the public database, and the file is compacted so
 *    the old rows do not linger in its free pages.
 *
 * If the vault already has different data, or anything does not match, it stops and leaves both
 * databases as they were. Returns null when there is nothing to import.
 */
export function importLegacyData(
  publicDb: Db,
  vaultDb: Db,
  opts: LegacyOptions = {}
): LegacyResult | null {
  const present = VAULT_TABLES.filter((t) => tableExists(publicDb, t))
  if (present.length === 0) return null

  const source = new Map<string, unknown[]>(present.map((t) => [t, readAll(publicDb, t)]))

  let backupPath: string | null = null
  if (opts.backupDir && [...source.values()].some((rows) => rows.length > 0)) {
    mkdirSync(opts.backupDir, { recursive: true })
    backupPath = join(opts.backupDir, legacyCopyName(opts.now?.() ?? new Date()))
    publicDb.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
  }

  const matches = (): boolean =>
    present.every((t) => fingerprint(source.get(t) ?? []) === fingerprint(readAll(vaultDb, t)))
  const vaultHasData = present.some((t) => readAll(vaultDb, t).length > 0)

  /**
   * Dropping a table only marks its pages free, so the rows would stay readable in `data.sqlite`.
   * VACUUM rewrites the file without them, but in WAL mode the rewrite (and the old pages) sit in
   * the `-wal` file until a checkpoint, and this connection stays open all session: the TRUNCATE
   * checkpoint writes it back and empties the WAL now.
   */
  const dropLegacy = (): void => {
    try {
      for (const t of [...present].reverse()) publicDb.exec(`DROP TABLE IF EXISTS ${t}`)
    } catch (err) {
      // The data is safe in the vault; leftovers are harmless and will be cleaned up next time.
      console.error('[vault] could not remove the old tables:', err)
      return
    }
    try {
      publicDb.exec('VACUUM')
      publicDb.pragma('wal_checkpoint(TRUNCATE)')
    } catch (err) {
      console.error('[vault] could not compact the public database:', err)
    }
  }

  const counts = Object.fromEntries(present.map((t) => [t, source.get(t)?.length ?? 0]))

  if (vaultHasData) {
    if (matches()) {
      dropLegacy()
      return { imported: counts, alreadyImported: true, backupPath }
    }
    throw new Error(
      'The old database and the Vault both contain different data, so nothing was moved. Both were left untouched.'
    )
  }

  vaultDb.transaction(() => {
    for (const t of present) {
      const rows = source.get(t) as Record<string, unknown>[]
      if (rows.length === 0) continue
      const cols = Object.keys(rows[0])
      const insert = vaultDb.prepare(
        `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      )
      for (const row of rows) insert.run(...cols.map((c) => row[c]))
    }
    if (!matches()) throw new Error('The copy did not match the original, so nothing was moved.')
  })()

  dropLegacy()
  return { imported: counts, alreadyImported: false, backupPath }
}
