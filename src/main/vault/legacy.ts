import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
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
 * 4. only then are the old tables dropped from the public database.
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
    const stamp = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
    backupPath = join(opts.backupDir, `data-before-vault-${stamp}.sqlite`)
    publicDb.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
  }

  const matches = (): boolean =>
    present.every((t) => fingerprint(source.get(t) ?? []) === fingerprint(readAll(vaultDb, t)))
  const vaultHasData = present.some((t) => readAll(vaultDb, t).length > 0)

  const dropLegacy = (): void => {
    try {
      for (const t of [...present].reverse()) publicDb.exec(`DROP TABLE IF EXISTS ${t}`)
      publicDb.exec('VACUUM')
    } catch (err) {
      // The data is safe in the vault; leftovers are harmless and will be cleaned up next time.
      console.error('[vault] could not remove the old tables:', err)
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
