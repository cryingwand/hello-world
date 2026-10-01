import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { PUBLIC_ROSTER_COLUMNS, SENSITIVE_COLUMNS } from '@shared/sensitive'
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

/** What the single-database app (before the vault) held; the legacy schema is frozen at this. */
const V1_TABLES = [
  'assignments',
  'classes',
  'enrollments',
  'file_links',
  'grade_categories',
  'scores',
  'students',
  'terms'
]
const ADVISING_TABLES = ['action_items', 'advising_meetings', 'external_progress', 'goals']
const QUIZ_TABLES = ['questions', 'quiz_items', 'quizzes']
const PLANNER_TABLES = [
  'lesson_assignments',
  'lesson_blocks',
  'lesson_classes',
  'lesson_quizzes',
  'lesson_tasks',
  'lessons',
  'units'
]
const VAULT_TABLES = [...V1_TABLES, ...ADVISING_TABLES, ...QUIZ_TABLES, ...PLANNER_TABLES].sort()

describe('migrations', () => {
  it('build a public database that holds settings and the names-only roster copy, nothing else', () => {
    const db = new Database(':memory:')
    const res = migrate(db, PUBLIC_MIGRATIONS)
    expect(res).toEqual({ from: 0, to: latestVersion(PUBLIC_MIGRATIONS) })
    expect(tables(db)).toEqual([...Object.keys(PUBLIC_ROSTER_COLUMNS), 'settings'].sort())
    // Exactly the allowlisted columns: no email, notes, tags or grades.
    for (const [table, cols] of Object.entries(PUBLIC_ROSTER_COLUMNS)) {
      const real = (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
      expect(real.sort(), table).toEqual([...cols].sort())
    }
  })

  it('add the roster copy to a version 1 public database without touching its settings', () => {
    const db = new Database(':memory:')
    migrate(db, PUBLIC_MIGRATIONS.slice(0, 1))
    db.prepare("INSERT INTO settings (key, value) VALUES ('keep', 'me')").run()
    expect(tables(db)).toEqual(['settings'])
    migrate(db, PUBLIC_MIGRATIONS)
    expect(db.prepare('SELECT key, value FROM settings').get()).toEqual({
      key: 'keep',
      value: 'me'
    })
    expect(tables(db)).toContain('roster_members')
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
    expect(tables(legacy)).toEqual([...V1_TABLES, 'settings'].sort())
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
    const v = latestVersion(VAULT_MIGRATIONS)
    const bad = [
      ...VAULT_MIGRATIONS,
      { version: v + 1, name: 'bad', sql: 'CREATE TABLE ok (a); CREATE TABLE ok (a);' }
    ]
    expect(() => migrate(db, bad)).toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(v)
    expect(tables(db)).not.toContain('ok')
  })

  it('upgrade an existing database without losing data', () => {
    const db = openVaultDatabase(':memory:')
    db.prepare("INSERT INTO terms (name) VALUES ('Keep me')").run()
    const v = latestVersion(VAULT_MIGRATIONS) + 1
    const next = [
      ...VAULT_MIGRATIONS,
      { version: v, name: 'add col', sql: 'ALTER TABLE terms ADD COLUMN note TEXT' }
    ]
    migrate(db, next)
    expect(db.prepare('SELECT name FROM terms').get()).toEqual({ name: 'Keep me' })
    expect(db.pragma('user_version', { simple: true })).toBe(v)
  })

  it('add the advising tables to a version 1 vault without touching its data', () => {
    const db = new Database(':memory:')
    migrate(db, VAULT_MIGRATIONS.slice(0, 1))
    db.prepare("INSERT INTO students (first_name, tags) VALUES ('Ada', '[\"advisee\"]')").run()
    expect(tables(db)).toEqual(V1_TABLES)
    migrate(db, VAULT_MIGRATIONS)
    expect(tables(db)).toEqual(VAULT_TABLES)
    expect(db.prepare('SELECT first_name FROM students').get()).toEqual({ first_name: 'Ada' })
  })

  it('add the quiz tables to a version 2 vault without touching its data', () => {
    const db = new Database(':memory:')
    migrate(db, VAULT_MIGRATIONS.slice(0, 2))
    db.prepare("INSERT INTO students (first_name) VALUES ('Ada')").run()
    expect(tables(db)).toEqual([...V1_TABLES, ...ADVISING_TABLES].sort())
    migrate(db, VAULT_MIGRATIONS)
    expect(tables(db)).toEqual(VAULT_TABLES)
    expect(db.prepare('SELECT first_name FROM students').get()).toEqual({ first_name: 'Ada' })
  })

  it('add the planner tables to a version 3 vault, keeping the file links it already has', () => {
    const db = new Database(':memory:')
    migrate(db, VAULT_MIGRATIONS.slice(0, 3))
    db.prepare("INSERT INTO terms (name) VALUES ('Fall')").run()
    db.prepare(
      "INSERT INTO file_links (path, record_type, record_id) VALUES ('/a/syllabus.pdf', 'term', 1)"
    ).run()
    expect(tables(db)).toEqual([...V1_TABLES, ...ADVISING_TABLES, ...QUIZ_TABLES].sort())
    migrate(db, VAULT_MIGRATIONS)
    expect(tables(db)).toEqual(VAULT_TABLES)
    expect(db.prepare('SELECT path, record_type, record_id FROM file_links').all()).toEqual([
      { path: '/a/syllabus.pdf', record_type: 'term', record_id: 1 }
    ])
    // The rebuilt table accepts the new record types, still refuses others, and is still unique.
    const add = db.prepare('INSERT INTO file_links (path, record_type, record_id) VALUES (?, ?, 1)')
    add.run('/a/plan.docx', 'lesson')
    add.run('/a/plan.docx', 'unit')
    expect(() => add.run('/a/plan.docx', 'quiz')).toThrow()
    expect(() => add.run('/a/plan.docx', 'unit')).toThrow()
    expect(
      (db.pragma('index_list(file_links)') as { name: string }[]).map((i) => i.name)
    ).toContain('idx_file_links_record')
  })

  it('add lesson links to a version 4 vault, keeping its units, lessons and quiz links', () => {
    const db = new Database(':memory:')
    migrate(db, VAULT_MIGRATIONS.slice(0, 4))
    db.prepare("INSERT INTO units (title) VALUES ('Ethics')").run()
    db.prepare("INSERT INTO lessons (unit_id, position, title) VALUES (1, 0, 'Day 1')").run()
    db.prepare("INSERT INTO quizzes (kind, title) VALUES ('quiz', 'Quiz 1')").run()
    db.prepare('INSERT INTO lesson_quizzes (lesson_id, quiz_id) VALUES (1, 1)').run()
    expect(tables(db)).not.toContain('lesson_classes')
    migrate(db, VAULT_MIGRATIONS)
    expect(tables(db)).toEqual(VAULT_TABLES)
    expect(db.prepare('SELECT title FROM lessons').get()).toEqual({ title: 'Day 1' })
    expect(db.prepare('SELECT lesson_id, quiz_id FROM lesson_quizzes').get()).toEqual({
      lesson_id: 1,
      quiz_id: 1
    })
  })

  it('add lesson blocks and tasks to a version 5 vault, keeping its lessons and units', () => {
    const db = new Database(':memory:')
    migrate(db, VAULT_MIGRATIONS.slice(0, 5))
    db.prepare("INSERT INTO units (title) VALUES ('Ethics')").run()
    db.prepare("INSERT INTO lessons (unit_id, position, title) VALUES (1, 0, 'Day 1')").run()
    migrate(db, VAULT_MIGRATIONS)
    expect(tables(db)).toEqual(VAULT_TABLES)
    expect(db.prepare('SELECT title, class_minutes FROM lessons').get()).toEqual({
      title: 'Day 1',
      class_minutes: null
    })
    expect(db.prepare('SELECT title, term_id FROM units').get()).toEqual({
      title: 'Ethics',
      term_id: null
    })
  })

  it('keep the question bank, quizzes and planner out of the public database', () => {
    const pub = openPublicDatabase(':memory:')
    for (const table of [...QUIZ_TABLES, ...PLANNER_TABLES]) {
      expect(tables(pub)).not.toContain(table)
    }
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
