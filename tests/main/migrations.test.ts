import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { SENSITIVE_COLUMNS } from '@shared/sensitive'
import { openDatabase } from '../../src/main/db/connection'
import { MIGRATIONS, latestVersion, migrate } from '../../src/main/db/migrations'

const tables = (db: Database.Database): string[] =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  )
    .map((r) => r.name)
    .sort()

describe('migrations', () => {
  it('build the full Phase 1 schema on an empty database', () => {
    const db = new Database(':memory:')
    const res = migrate(db)
    expect(res).toEqual({ from: 0, to: latestVersion() })
    expect(tables(db)).toEqual([
      'assignments',
      'classes',
      'enrollments',
      'file_links',
      'grade_categories',
      'scores',
      'settings',
      'students',
      'terms'
    ])
    expect(db.pragma('user_version', { simple: true })).toBe(latestVersion())
  })

  it('are idempotent', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(migrate(db)).toEqual({ from: latestVersion(), to: latestVersion() })
  })

  it('refuse a database from a newer app', () => {
    const db = new Database(':memory:')
    db.pragma(`user_version = ${latestVersion() + 1}`)
    expect(() => migrate(db)).toThrow(/newer than this app/)
  })

  it('reject gaps or duplicates in numbering', () => {
    const db = new Database(':memory:')
    expect(() => migrate(db, [{ version: 2, name: 'x', sql: 'SELECT 1' }])).toThrow(/without gaps/)
    expect(() => migrate(db, [MIGRATIONS[0], MIGRATIONS[0]])).toThrow(/without gaps/)
  })

  it('roll a failing migration back and leave the version untouched', () => {
    const db = new Database(':memory:')
    migrate(db)
    const bad = [
      ...MIGRATIONS,
      { version: 2, name: 'bad', sql: 'CREATE TABLE ok (a); CREATE TABLE ok (a);' }
    ]
    expect(() => migrate(db, bad)).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(tables(db)).not.toContain('ok')
  })

  it('upgrade an existing database without losing data', () => {
    const db = openDatabase(':memory:')
    db.prepare("INSERT INTO terms (name) VALUES ('Keep me')").run()
    const next = [
      ...MIGRATIONS,
      { version: 2, name: 'add col', sql: 'ALTER TABLE terms ADD COLUMN note TEXT' }
    ]
    migrate(db, next)
    expect(db.prepare('SELECT name FROM terms').get()).toEqual({ name: 'Keep me' })
    expect(db.pragma('user_version', { simple: true })).toBe(2)
  })

  it('enable foreign keys on connections opened by the app', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('tag only columns that really exist as sensitive', () => {
    const db = openDatabase(':memory:')
    for (const [table, cols] of Object.entries(SENSITIVE_COLUMNS)) {
      const real = (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
      for (const c of cols) expect(real, `${table}.${c}`).toContain(c)
    }
  })
})
