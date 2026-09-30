import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LEGACY_SCHEMA_SQL, VAULT_MIGRATIONS, migrate } from '../../src/main/db/migrations'
import { VAULT_TABLES, importLegacyData } from '../../src/main/vault/legacy'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-legacy-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A database exactly as the single-database version left it, with some real-looking data. */
function legacyDb(path = ':memory:'): Database.Database {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  db.exec(LEGACY_SCHEMA_SQL)
  db.pragma('user_version = 1')
  db.exec(`
    INSERT INTO terms (id, name, start_date, is_current) VALUES (1, 'Fall 2026', '2026-09-01', 1), (7, 'Spring 2026', NULL, 0);
    INSERT INTO students (id, first_name, last_name, preferred_name, email, notes, tags, created_at)
      VALUES (3, 'Zephyrine', 'Quillfeather', 'Zee', 'z@example.org', 'note', '["advisee"]', '2026-09-02 10:00:00'),
             (9, 'Bartholomew', 'Oddfellow', '', '', '', '[]', '2026-09-03 11:30:00');
    INSERT INTO classes (id, term_id, course, section, period, grading_mode) VALUES (5, 1, 'History', 'B', '3', 'weighted');
    INSERT INTO enrollments (id, class_id, student_id) VALUES (2, 5, 3), (4, 5, 9);
    INSERT INTO grade_categories (id, class_id, name, weight, sort_order) VALUES (8, 5, 'Tests', 60, 0);
    INSERT INTO assignments (id, class_id, category_id, title, points_possible, sort_order) VALUES (6, 5, 8, 'Quiz', 20, 0);
    INSERT INTO scores (id, assignment_id, student_id, points, status, comment) VALUES (11, 6, 3, 17.5, 'late', 'handed in Tuesday'), (12, 6, 9, NULL, 'missing', '');
    INSERT INTO file_links (id, path, record_type, record_id) VALUES (1, '/Users/t/iep.pdf', 'student', 3);
    INSERT INTO settings (key, value) VALUES ('teachingFolders', '["/Users/t/Courses"]');
  `)
  return db
}

function vaultDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db, VAULT_MIGRATIONS)
  return db
}

const rows = (db: Database.Database, t: string): unknown[] =>
  db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()
const tables = (db: Database.Database): string[] =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  )
    .map((r) => r.name)
    .sort()

describe('importLegacyData', () => {
  it('returns null for a database that has no legacy tables', () => {
    const fresh = new Database(':memory:')
    fresh.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    expect(importLegacyData(fresh, vaultDb())).toBeNull()
  })

  it('moves every row with its ids and every column intact', () => {
    const pub = legacyDb()
    const vault = vaultDb()
    const before = Object.fromEntries(VAULT_TABLES.map((t) => [t, rows(pub, t)]))
    const res = importLegacyData(pub, vault)!
    expect(res.alreadyImported).toBe(false)
    expect(res.imported).toMatchObject({
      terms: 2,
      students: 2,
      classes: 1,
      enrollments: 2,
      scores: 2,
      file_links: 1
    })
    for (const t of VAULT_TABLES) expect(rows(vault, t), t).toEqual(before[t])
    // spot-check columns that are easy to lose
    expect(vault.prepare('SELECT created_at FROM students WHERE id = 3').get()).toEqual({
      created_at: '2026-09-02 10:00:00'
    })
    expect(vault.prepare('SELECT status, comment FROM scores WHERE id = 11').get()).toEqual({
      status: 'late',
      comment: 'handed in Tuesday'
    })
  })

  it('keeps foreign keys working, and new rows continue after the moved ids', () => {
    const vault = vaultDb()
    importLegacyData(legacyDb(), vault)
    expect(vault.pragma('foreign_key_check')).toEqual([])
    const next = vault
      .prepare("INSERT INTO students (first_name, last_name) VALUES ('New', 'Kid')")
      .run()
    expect(Number(next.lastInsertRowid)).toBe(10)
  })

  it('removes the old tables from the public database but keeps its settings', () => {
    const pub = legacyDb()
    importLegacyData(pub, vaultDb())
    expect(tables(pub)).toEqual(['settings'])
    expect(pub.prepare('SELECT value FROM settings WHERE key = ?').get('teachingFolders')).toEqual({
      value: '["/Users/t/Courses"]'
    })
  })

  it('saves a full copy of the old database first', () => {
    const dir = tmp()
    const pub = legacyDb()
    const res = importLegacyData(pub, vaultDb(), {
      backupDir: dir,
      now: () => new Date('2026-09-30T10:00:00Z')
    })!
    expect(res.backupPath).toBeTruthy()
    expect(readdirSync(dir)).toHaveLength(1)
    const copy = new Database(res.backupPath!, { readonly: true })
    expect((copy.prepare('SELECT COUNT(*) n FROM students').get() as { n: number }).n).toBe(2)
    copy.close()
  })

  it('is idempotent: a second run finds nothing to do', () => {
    const pub = legacyDb()
    const vault = vaultDb()
    importLegacyData(pub, vault)
    expect(importLegacyData(pub, vault)).toBeNull()
    expect(rows(vault, 'students')).toHaveLength(2)
  })

  it('finishes cleanup if an earlier run copied the data but did not remove the old tables', () => {
    const pub = legacyDb()
    const vault = vaultDb()
    // simulate the interruption: copy without dropping, by importing from a disposable clone
    const clone = legacyDb()
    importLegacyData(clone, vault)
    const res = importLegacyData(pub, vault)!
    expect(res.alreadyImported).toBe(true)
    expect(tables(pub)).toEqual(['settings'])
    expect(rows(vault, 'students')).toHaveLength(2)
  })

  it('refuses, changing nothing, when the vault already holds different data', () => {
    const pub = legacyDb()
    const vault = vaultDb()
    vault.exec("INSERT INTO students (first_name, last_name) VALUES ('Someone', 'Else')")
    expect(() => importLegacyData(pub, vault)).toThrow(/both contain different data/)
    expect(tables(pub)).toContain('students')
    expect(rows(pub, 'students')).toHaveLength(2)
    expect(rows(vault, 'students')).toHaveLength(1)
  })

  it('rolls the vault back and leaves the old database untouched if a row cannot be copied', () => {
    const pub = legacyDb()
    const vault = vaultDb()
    // A vault with a stricter rule makes the third table fail part-way through.
    vault.exec(
      "CREATE TRIGGER refuse_classes BEFORE INSERT ON classes BEGIN SELECT RAISE(ABORT, 'nope'); END"
    )
    expect(() => importLegacyData(pub, vault)).toThrow()
    for (const t of VAULT_TABLES) expect(rows(vault, t), t).toEqual([])
    expect(tables(pub)).toContain('students')
    expect(rows(pub, 'scores')).toHaveLength(2)
  })

  it('does not treat a verification mismatch as success', () => {
    const pub = legacyDb()
    const vault = vaultDb()
    // A trigger that quietly alters what is stored, as a bug or corruption might.
    vault.exec(
      "CREATE TRIGGER alter_notes AFTER INSERT ON students BEGIN UPDATE students SET notes = 'changed' WHERE id = NEW.id; END"
    )
    expect(() => importLegacyData(pub, vault)).toThrow(/did not match/)
    expect(rows(vault, 'students')).toEqual([])
    expect(rows(pub, 'students')).toHaveLength(2)
  })

  it('works on an empty legacy database (nothing to move, still drops the tables)', () => {
    const pub = new Database(':memory:')
    pub.exec(LEGACY_SCHEMA_SQL)
    const res = importLegacyData(pub, vaultDb())!
    expect(Object.values(res.imported).every((n) => n === 0)).toBe(true)
    expect(tables(pub)).toEqual(['settings'])
  })

  it('works with a database on disk and leaves no backup when there is nothing to keep', () => {
    const dir = tmp()
    const pub = new Database(join(dir, 'data.sqlite'))
    pub.exec(LEGACY_SCHEMA_SQL)
    const backups = join(dir, 'backups')
    importLegacyData(pub, vaultDb(), { backupDir: backups })
    expect(existsSync(backups)).toBe(false)
  })
})
