import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PUBLIC_MIGRATIONS, VAULT_MIGRATIONS, migrate, type Migration } from './migrations'

/** Opens (creating if needed) a database, applies pragmas and runs its pending migrations. */
function openDatabase(path: string, migrations: Migration[]): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db, migrations)
  return db
}

/** The everyday database: settings only. */
export const openPublicDatabase = (path: string): Database.Database =>
  openDatabase(path, PUBLIC_MIGRATIONS)

/** The vault database: students, classes, grades, file links. Only open while the vault is unlocked. */
export const openVaultDatabase = (path: string): Database.Database =>
  openDatabase(path, VAULT_MIGRATIONS)
