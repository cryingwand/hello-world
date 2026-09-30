import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Append-only. Never edit a shipped migration; add a new one with the next version.
 * Later phases add their own tables (advising, quizzes, lessons) as new migrations.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema: rosters, gradebook, file links, settings',
    sql: `
      CREATE TABLE terms (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        start_date TEXT,
        end_date   TEXT,
        is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1))
      );

      CREATE TABLE students (
        id             INTEGER PRIMARY KEY,
        first_name     TEXT NOT NULL DEFAULT '',
        last_name      TEXT NOT NULL DEFAULT '',
        preferred_name TEXT NOT NULL DEFAULT '',
        email          TEXT NOT NULL DEFAULT '',
        notes          TEXT NOT NULL DEFAULT '',
        tags           TEXT NOT NULL DEFAULT '[]',
        created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE classes (
        id           INTEGER PRIMARY KEY,
        term_id      INTEGER NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
        course       TEXT NOT NULL,
        section      TEXT NOT NULL DEFAULT '',
        period       TEXT NOT NULL DEFAULT '',
        grading_mode TEXT NOT NULL DEFAULT 'points' CHECK (grading_mode IN ('weighted', 'points')),
        created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE enrollments (
        id         INTEGER PRIMARY KEY,
        class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        UNIQUE (class_id, student_id)
      );
      CREATE INDEX idx_enrollments_student ON enrollments(student_id);

      CREATE TABLE grade_categories (
        id         INTEGER PRIMARY KEY,
        class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        weight     REAL NOT NULL DEFAULT 0 CHECK (weight >= 0),
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_categories_class ON grade_categories(class_id);

      CREATE TABLE assignments (
        id              INTEGER PRIMARY KEY,
        class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        category_id     INTEGER REFERENCES grade_categories(id) ON DELETE SET NULL,
        title           TEXT NOT NULL,
        points_possible REAL NOT NULL DEFAULT 0 CHECK (points_possible >= 0),
        due_date        TEXT,
        source_app      TEXT,
        source_id       TEXT,
        sort_order      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_assignments_class ON assignments(class_id);

      CREATE TABLE scores (
        id            INTEGER PRIMARY KEY,
        assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        points        REAL CHECK (points IS NULL OR points >= 0),
        status        TEXT CHECK (status IS NULL OR status IN ('missing', 'excused', 'late')),
        comment       TEXT NOT NULL DEFAULT '',
        UNIQUE (assignment_id, student_id)
      );
      CREATE INDEX idx_scores_student ON scores(student_id);

      CREATE TABLE file_links (
        id          INTEGER PRIMARY KEY,
        path        TEXT NOT NULL,
        record_type TEXT NOT NULL CHECK (record_type IN ('student', 'class', 'term')),
        record_id   INTEGER NOT NULL,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (path, record_type, record_id)
      );
      CREATE INDEX idx_file_links_record ON file_links(record_type, record_id);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  }
]

export function latestVersion(migrations: Migration[] = MIGRATIONS): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0)
}

/** Applies pending migrations, each in its own transaction, tracked with PRAGMA user_version. */
export function migrate(
  db: Database.Database,
  migrations: Migration[] = MIGRATIONS
): { from: number; to: number } {
  const sorted = [...migrations].sort((a, b) => a.version - b.version)
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `Migrations must be numbered 1..n without gaps (found ${m.version} at #${i + 1})`
      )
    }
  })
  const from = db.pragma('user_version', { simple: true }) as number
  const latest = latestVersion(sorted)
  if (from > latest) {
    throw new Error(
      `This database is version ${from}, newer than this app understands (${latest}). Update the app.`
    )
  }
  for (const m of sorted) {
    if (m.version <= from) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })()
  }
  return { from, to: latest }
}
