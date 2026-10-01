import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Two databases, two histories. Append-only in each: never edit a shipped migration; add a new one
 * with the next version.
 *
 * - `data.sqlite` (public) holds settings, the names-only roster copy and the desktop arrangement.
 * - `vault.sqlite` holds everything about students, classes and grades, plus file links. A new table
 *   belongs in the vault unless there is a deliberate decision that it is safe to show anywhere.
 */
const SETTINGS_SQL = `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `

const VAULT_V1_SQL = `
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
    `

/**
 * Advising: meetings, goals, follow-ups and grades an advisee earned elsewhere. All of it is about a
 * student, so it lives in the vault and goes when the student does. A deleted meeting or goal leaves
 * its follow-ups behind (the link is cleared); they still belong to the student.
 */
const VAULT_V2_SQL = `
      CREATE TABLE advising_meetings (
        id         INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        met_on     TEXT NOT NULL,
        topic      TEXT NOT NULL DEFAULT '',
        notes      TEXT NOT NULL DEFAULT '',
        summary    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_meetings_student ON advising_meetings(student_id, met_on);

      CREATE TABLE goals (
        id          INTEGER PRIMARY KEY,
        student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        details     TEXT NOT NULL DEFAULT '',
        target_date TEXT,
        status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'dropped')),
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_goals_student ON goals(student_id);

      CREATE TABLE action_items (
        id           INTEGER PRIMARY KEY,
        student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        meeting_id   INTEGER REFERENCES advising_meetings(id) ON DELETE SET NULL,
        goal_id      INTEGER REFERENCES goals(id) ON DELETE SET NULL,
        title        TEXT NOT NULL,
        due_date     TEXT,
        owner        TEXT NOT NULL DEFAULT 'student' CHECK (owner IN ('student', 'me')),
        completed_on TEXT,
        created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_actions_student ON action_items(student_id);
      CREATE INDEX idx_actions_meeting ON action_items(meeting_id);

      CREATE TABLE external_progress (
        id          INTEGER PRIMARY KEY,
        student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        course      TEXT NOT NULL,
        term        TEXT NOT NULL DEFAULT '',
        grade       TEXT NOT NULL DEFAULT '',
        source      TEXT NOT NULL DEFAULT '',
        recorded_on TEXT,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_progress_student ON external_progress(student_id);
    `

/**
 * Quiz & Exam Builder: the question bank, quizzes and the questions in them. Exams are exactly the
 * material the Vault exists to protect, so none of it is in the public database. A question that is
 * in a quiz cannot be deleted (RESTRICT) so a printed exam can never lose a question silently; a
 * deleted quiz takes only its list of questions with it. The Gradebook link is the assignment's own
 * source_app/source_id, so it needs no column here.
 */
const VAULT_V3_SQL = `
      CREATE TABLE questions (
        id             INTEGER PRIMARY KEY,
        kind           TEXT NOT NULL
                       CHECK (kind IN ('multiple-choice', 'true-false', 'short-answer', 'essay')),
        prompt         TEXT NOT NULL,
        choices        TEXT NOT NULL DEFAULT '[]',
        correct_choice INTEGER,
        answer         TEXT NOT NULL DEFAULT '',
        points         REAL NOT NULL DEFAULT 1 CHECK (points >= 0),
        tags           TEXT NOT NULL DEFAULT '[]',
        created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE quizzes (
        id           INTEGER PRIMARY KEY,
        kind         TEXT NOT NULL DEFAULT 'quiz' CHECK (kind IN ('quiz', 'exam')),
        title        TEXT NOT NULL,
        course       TEXT NOT NULL DEFAULT '',
        quiz_date    TEXT,
        instructions TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE quiz_items (
        id          INTEGER PRIMARY KEY,
        quiz_id     INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
        position    INTEGER NOT NULL,
        points      REAL CHECK (points IS NULL OR points >= 0),
        UNIQUE (quiz_id, question_id)
      );
      CREATE INDEX idx_quiz_items_question ON quiz_items(question_id);
    `

/**
 * Lesson & Unit Planner: units, the lessons in them (in order) and the quizzes a lesson uses. Lessons
 * point at exams and attach protected files, so the planner is vault data like the quizzes it links to.
 * A deleted unit takes its lessons with it; a deleted quiz only loses its links. file_links must now
 * accept units and lessons, and SQLite cannot change a CHECK in place, so the table is rebuilt.
 */
const VAULT_V4_SQL = `
      CREATE TABLE units (
        id         INTEGER PRIMARY KEY,
        title      TEXT NOT NULL,
        course     TEXT NOT NULL DEFAULT '',
        summary    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE lessons (
        id          INTEGER PRIMARY KEY,
        unit_id     INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        title       TEXT NOT NULL,
        lesson_date TEXT,
        objectives  TEXT NOT NULL DEFAULT '',
        plan        TEXT NOT NULL DEFAULT '',
        homework    TEXT NOT NULL DEFAULT '',
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_lessons_unit ON lessons(unit_id, position);
      CREATE INDEX idx_lessons_date ON lessons(lesson_date);

      CREATE TABLE lesson_quizzes (
        lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        quiz_id   INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        PRIMARY KEY (lesson_id, quiz_id)
      );
      CREATE INDEX idx_lesson_quizzes_quiz ON lesson_quizzes(quiz_id);

      CREATE TABLE file_links_v4 (
        id          INTEGER PRIMARY KEY,
        path        TEXT NOT NULL,
        record_type TEXT NOT NULL
                    CHECK (record_type IN ('student', 'class', 'term', 'unit', 'lesson')),
        record_id   INTEGER NOT NULL,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (path, record_type, record_id)
      );
      INSERT INTO file_links_v4 (id, path, record_type, record_id, created_at)
        SELECT id, path, record_type, record_id, created_at FROM file_links;
      DROP TABLE file_links;
      ALTER TABLE file_links_v4 RENAME TO file_links;
      CREATE INDEX idx_file_links_record ON file_links(record_type, record_id);
    `

/**
 * A lesson is taught to one or more classes and can point at the Gradebook assignments that go with it
 * (the homework, the quiz). Both links are only that: deleting a class or an assignment removes the link,
 * and deleting a lesson never touches the Gradebook. They cascade from every side.
 */
const VAULT_V5_SQL = `
      CREATE TABLE lesson_classes (
        lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        class_id  INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        PRIMARY KEY (lesson_id, class_id)
      );
      CREATE INDEX idx_lesson_classes_class ON lesson_classes(class_id);

      CREATE TABLE lesson_assignments (
        lesson_id     INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        PRIMARY KEY (lesson_id, assignment_id)
      );
      CREATE INDEX idx_lesson_assignments_assignment ON lesson_assignments(assignment_id);
    `

/**
 * The lesson builder. A lesson is made of blocks (a lecture, a discussion, a reading) in order, each
 * with a rough length, measured against how long the class meets. Adding a block adds the prep it needs
 * to the lesson's tasks, which make the to-do list; a task added by hand has no block. Both go with
 * their lesson, and a block's tasks go with the block. A unit can belong to a semester (a term) for the
 * semester roadmap; deleting the term only clears that.
 */
const VAULT_V6_SQL = `
      CREATE TABLE lesson_blocks (
        id        INTEGER PRIMARY KEY,
        lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        position  INTEGER NOT NULL DEFAULT 0,
        kind      TEXT NOT NULL,
        title     TEXT NOT NULL DEFAULT '',
        minutes   INTEGER CHECK (minutes IS NULL OR minutes >= 0),
        details   TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_lesson_blocks_lesson ON lesson_blocks(lesson_id, position);

      CREATE TABLE lesson_tasks (
        id        INTEGER PRIMARY KEY,
        lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
        block_id  INTEGER REFERENCES lesson_blocks(id) ON DELETE CASCADE,
        position  INTEGER NOT NULL DEFAULT 0,
        text      TEXT NOT NULL,
        done      INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
      );
      CREATE INDEX idx_lesson_tasks_lesson ON lesson_tasks(lesson_id, position);
      CREATE INDEX idx_lesson_tasks_block ON lesson_tasks(block_id);

      ALTER TABLE lessons ADD COLUMN class_minutes INTEGER CHECK (class_minutes IS NULL OR class_minutes > 0);
      ALTER TABLE units ADD COLUMN term_id INTEGER REFERENCES terms(id) ON DELETE SET NULL;
      CREATE INDEX idx_units_term ON units(term_id);
    `

/**
 * A names-only copy of the class rosters, kept in the everyday database so the launcher can use a
 * roster (for the picker, groups and seating chart) while the Vault is locked or a presentation is
 * running. The Vault stays the only place a roster is edited: the copy is rewritten from it whenever it
 * changes and is never written from anywhere else. It holds names and nothing else: no email, notes or
 * tags (the advisee tag would reveal who you advise), and none of the gradebook. A deliberate decision
 * that these names are safe to show in the everyday window.
 */
const ROSTER_COPY_SQL = `
      CREATE TABLE roster_classes (
        class_id     INTEGER PRIMARY KEY,
        course       TEXT NOT NULL,
        section      TEXT NOT NULL DEFAULT '',
        period       TEXT NOT NULL DEFAULT '',
        term_name    TEXT NOT NULL DEFAULT '',
        current_term INTEGER NOT NULL DEFAULT 0,
        position     INTEGER NOT NULL
      );
      CREATE TABLE roster_members (
        class_id       INTEGER NOT NULL REFERENCES roster_classes(class_id) ON DELETE CASCADE,
        student_id     INTEGER NOT NULL,
        first_name     TEXT NOT NULL,
        last_name      TEXT NOT NULL,
        preferred_name TEXT NOT NULL DEFAULT '',
        position       INTEGER NOT NULL,
        PRIMARY KEY (class_id, student_id)
      );
    `

/**
 * The everyday desktop's own arrangement: files and folders pinned to the canvas, and the labelled
 * areas that group them. A deliberate decision that this is safe outside the Vault: it holds paths of
 * files the everyday window can already see (a pin is refused for a protected file, and one that
 * becomes protected later is not shown) and the labels the teacher types. No student data.
 */
const DESK_SQL = `
      CREATE TABLE desk_items (
        id    INTEGER PRIMARY KEY,
        kind  TEXT NOT NULL CHECK (kind IN ('file', 'folder', 'area')),
        path  TEXT,
        label TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '',
        x     REAL NOT NULL,
        y     REAL NOT NULL,
        w     REAL NOT NULL,
        h     REAL NOT NULL,
        CHECK ((kind = 'area') = (path IS NULL))
      );
    `

export const PUBLIC_MIGRATIONS: Migration[] = [
  { version: 1, name: 'settings', sql: SETTINGS_SQL },
  { version: 2, name: 'names-only roster copy', sql: ROSTER_COPY_SQL },
  { version: 3, name: 'desktop arrangement', sql: DESK_SQL }
]

export const VAULT_MIGRATIONS: Migration[] = [
  { version: 1, name: 'rosters, gradebook and file links', sql: VAULT_V1_SQL },
  { version: 2, name: 'advising', sql: VAULT_V2_SQL },
  { version: 3, name: 'questions and quizzes', sql: VAULT_V3_SQL },
  { version: 4, name: 'units and lessons', sql: VAULT_V4_SQL },
  { version: 5, name: 'lessons linked to classes and assignments', sql: VAULT_V5_SQL },
  { version: 6, name: 'lesson blocks, prep tasks and semesters', sql: VAULT_V6_SQL }
]

/**
 * The single-database schema from before the vault existed. A database that has these tables is a
 * "legacy" database whose student data must be moved into the vault. Kept for recognising and
 * testing that case; never applied to new databases.
 */
export const LEGACY_SCHEMA_SQL = SETTINGS_SQL + VAULT_V1_SQL

export function latestVersion(migrations: Migration[]): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0)
}

/** Applies pending migrations, each in its own transaction, tracked with PRAGMA user_version. */
export function migrate(
  db: Database.Database,
  migrations: Migration[]
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
