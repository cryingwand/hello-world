import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { SENSITIVE_COLUMNS } from '@shared/sensitive'
import { openPublicDatabase, openVaultDatabase } from '../../src/main/db/connection'
import {
  LEGACY_SCHEMA_SQL,
  PUBLIC_MIGRATIONS,
  VAULT_MIGRATIONS,
  latestVersion,
  migrate
} from '../../src/main/db/migrations'

const tables = (db: Database.Database): string[] =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  )
    .map((r) => r.name)
    .sort()

const VAULT_TABLES = [
  'assignments',
  'classes',
  'enrollments',
  'file_links',
  'grade_categories',
  'scores',
  'students',
  'terms'
]

describe('migrations', () => {
  it('build a public database that holds settings and nothing about students', () => {
    const db = new Database(':memory:')
    const res = migrate(db, PUBLIC_MIGRATIONS)
    expect(res).toEqual({ from: 0, to: latestVersion(PUBLIC_MIGRATIONS) })
    expect(tables(db)).toEqual(['settings'])
  })

  it('build the vault schema on an empty database, without settings', () => {
    const db = new Database(':memory:')
    const res = migrate(db, VAULT_MIGRATIONS)
    expect(res).toEqual({ from: 0, to: latestVersion(VAULT_MIGRATIONS) })
    expect(tables(db)).toEqual(VAULT_TABLES)
    expect(db.pragma('user_version', { simple: true })).toBe(latestVersion(VAULT_MIGRATIONS))
  })

  it('keeps the legacy single-database schema equal to public plus vault', () => {
    const legacy = new Database(':memory:')
    legacy.exec(LEGACY_SCHEMA_SQL)
    expect(tables(legacy)).toEqual([...VAULT_TABLES, 'settings'].sort())
  })

  it('are idempotent', () => {
    const db = new Database(':memory:')
    migrate(db, VAULT_MIGRATIONS)
    const v = latestVersion(VAULT_MIGRATIONS)
    expect(migrate(db, VAULT_MIGRATIONS)).toEqual({ from: v, to: v })
  })

  it('refuse a database from a newer app', () => {
    const db = new Database(':memory:')
    db.pragma(`user_version = ${latestVersion(VAULT_MIGRATIONS) + 1}`)
    expect(() => migrate(db, VAULT_MIGRATIONS)).toThrow(/newer than this app/)
  })

  it('reject gaps or duplicates in numbering', () => {
    const db = new Database(':memory:')
    expect(() => migrate(db, [{ version: 2, name: 'x', sql: 'SELECT 1' }])).toThrow(/without gaps/)
    expect(() => migrate(db, [VAULT_MIGRATIONS[0], VAULT_MIGRATIONS[0]])).toThrow(/without gaps/)
  })

  it('roll a failing migration back and leave the version untouched', () => {
    const db = new Database(':memory:')
    migrate(db, VAULT_MIGRATIONS)
    const bad = [
      ...VAULT_MIGRATIONS,
      { version: 2, name: 'bad', sql: 'CREATE TABLE ok (a); CREATE TABLE ok (a);' }
    ]
    expect(() => migrate(db, bad)).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(tables(db)).not.toContain('ok')
  })

  it('upgrade an existing database without losing data', () => {
    const db = openVaultDatabase(':memory:')
    db.prepare("INSERT INTO terms (name) VALUES ('Keep me')").run()
    const next = [
      ...VAULT_MIGRATIONS,
      { version: 2, name: 'add col', sql: 'ALTER TABLE terms ADD COLUMN note TEXT' }
    ]
    migrate(db, next)
    expect(db.prepare('SELECT name FROM terms').get()).toEqual({ name: 'Keep me' })
    expect(db.pragma('user_version', { simple: true })).toBe(2)
  })

  it('enable foreign keys on connections opened by the app', () => {
    expect(openVaultDatabase(':memory:').pragma('foreign_keys', { simple: true })).toBe(1)
    expect(openPublicDatabase(':memory:').pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('tag only columns that really exist as sensitive, and keep them all in the vault', () => {
    const db = openVaultDatabase(':memory:')
    for (const [table, cols] of Object.entries(SENSITIVE_COLUMNS)) {
      const real = (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
      for (const c of cols) expect(real, `${table}.${c}`).toContain(c)
    }
    // The public database must never grow a table that holds one of these columns.
    const pub = openPublicDatabase(':memory:')
    for (const table of Object.keys(SENSITIVE_COLUMNS)) expect(tables(pub)).not.toContain(table)
  })
})
