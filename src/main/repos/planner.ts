import { localToday } from '@shared/advising'
import type {
  BlockInput,
  LessonCopyInput,
  LessonInput,
  TaskInput,
  UnitCopyInput,
  UnitInput
} from '@shared/api'
import {
  BLOCK_INFO,
  BLOCK_KINDS,
  MAX_BLOCKS,
  MAX_BLOCK_MINUTES,
  MAX_TASKS
} from '@shared/lessonBlocks'
import {
  MAX_LESSONS,
  MAX_SHIFT_DAYS,
  UPCOMING_LIMIT,
  copiedDate,
  copyTitle,
  type CopyDates
} from '@shared/lesson'
import type {
  Lesson,
  LessonBlock,
  LessonTask,
  LinkedAssignment,
  LinkedClass,
  LinkedQuiz,
  QuizKind,
  TodoItem,
  Unit,
  UnitDetail,
  UnitSummary,
  UpcomingLesson
} from '@shared/models'
import * as v from '../validate'
import type { Db, Emit } from './types'

interface UnitRow {
  id: number
  title: string
  course: string
  summary: string
  term_id: number | null
}
interface SummaryRow extends UnitRow {
  lesson_count: number
  first_date: string | null
  last_date: string | null
}
interface LessonRow {
  id: number
  unit_id: number
  position: number
  title: string
  lesson_date: string | null
  objectives: string
  plan: string
  homework: string
  notes: string
  class_minutes: number | null
}
interface BlockRow {
  id: number
  lesson_id: number
  position: number
  kind: string
  title: string
  minutes: number | null
  details: string
}
interface TaskRow {
  id: number
  lesson_id: number
  block_id: number | null
  position: number
  text: string
  done: number
}
interface QuizLinkRow {
  lesson_id: number
  id: number
  kind: QuizKind
  title: string
  quiz_date: string | null
}

interface ClassLinkRow {
  lesson_id: number
  id: number
  course: string
  section: string
  period: string
  term_name: string
}
interface AssignmentLinkRow {
  lesson_id: number
  id: number
  class_id: number
  title: string
  points_possible: number
  due_date: string | null
}

const toUnit = (r: UnitRow): Unit => ({
  id: r.id,
  title: r.title,
  course: r.course,
  summary: r.summary,
  termId: r.term_id
})
const toBlock = (r: BlockRow): LessonBlock => ({
  id: r.id,
  lessonId: r.lesson_id,
  position: r.position,
  kind: r.kind,
  title: r.title,
  minutes: r.minutes,
  details: r.details
})
const toTask = (r: TaskRow): LessonTask => ({
  id: r.id,
  lessonId: r.lesson_id,
  blockId: r.block_id,
  position: r.position,
  text: r.text,
  done: r.done === 1
})

interface TodoRow extends TaskRow {
  lesson_title: string
  lesson_date: string | null
  unit_id: number
  unit_title: string
  course: string
  block_kind: string | null
  block_title: string | null
}

/** Done tasks shown at most, newest first. */
const DONE_LIMIT = 300

// A lesson's plan can run to a page of steps; the rest are short.
const MAX_PLAN = 20000
const MAX_TEXT = 10000

/** Whole minutes from 0 (or 1 for a class) up to a long day, or null for none given. */
function minutesOrNull(value: unknown, field: string, min = 0): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = v.num(value, field, min)
  if (!Number.isInteger(n) || n > MAX_BLOCK_MINUTES) {
    throw new v.ValidationError(`${field} must be whole minutes, up to ${MAX_BLOCK_MINUTES}`)
  }
  return n
}

/** The date rule for a copy. Nothing given means clear them: a copy is for later. */
function copyDates(value: unknown): CopyDates {
  if (value == null) return { mode: 'clear' }
  const d = value as { mode?: unknown; days?: unknown }
  const mode = v.oneOf(d.mode, ['keep', 'clear', 'shift'] as const, 'Dates')
  if (mode !== 'shift') return { mode }
  const days = v.num(d.days, 'Days', -MAX_SHIFT_DAYS)
  if (!Number.isInteger(days) || days > MAX_SHIFT_DAYS) {
    throw new v.ValidationError(
      `Move the dates by a whole number of days, up to ${MAX_SHIFT_DAYS} either way`
    )
  }
  return { mode, days }
}

/** Units, the lessons in them and the quizzes a lesson uses. One repository, two API namespaces. */
export function plannerRepo(db: Db, emit: Emit, today: () => string = localToday) {
  const getUnit = (id: number): Unit | null => {
    const r = db.prepare('SELECT * FROM units WHERE id = ?').get(id) as UnitRow | undefined
    return r ? toUnit(r) : null
  }
  const mustUnit = (id: number): Unit => {
    const u = getUnit(id)
    if (!u) throw new v.ValidationError('That unit no longer exists')
    return u
  }

  /** A semester to put a unit in: an existing term, or null for none. */
  const termOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null
    const id = v.id(value, 'Semester')
    if (!db.prepare('SELECT 1 FROM terms WHERE id = ?').get(id)) {
      throw new v.ValidationError('That semester no longer exists')
    }
    return id
  }

  /** Attaches each lesson's quizzes, classes and assignments with one query each, whatever the number of lessons. */
  const withLinks = (rows: LessonRow[]): Lesson[] => {
    const quizzesBy = new Map<number, LinkedQuiz[]>()
    const classesBy = new Map<number, LinkedClass[]>()
    const assignmentsBy = new Map<number, LinkedAssignment[]>()
    const blocksBy = new Map<number, LessonBlock[]>()
    const tasksBy = new Map<number, LessonTask[]>()
    const push = <T>(map: Map<number, T[]>, key: number, item: T): void => {
      map.set(key, [...(map.get(key) ?? []), item])
    }
    if (rows.length > 0) {
      const marks = rows.map(() => '?').join(', ')
      const ids = rows.map((r) => r.id)
      const quizLinks = db
        .prepare(
          `SELECT lq.lesson_id, z.id, z.kind, z.title, z.quiz_date
           FROM lesson_quizzes lq JOIN quizzes z ON z.id = lq.quiz_id
           WHERE lq.lesson_id IN (${marks})
           ORDER BY COALESCE(z.quiz_date, '9999'), z.id`
        )
        .all(...ids) as QuizLinkRow[]
      for (const l of quizLinks) {
        push(quizzesBy, l.lesson_id, { id: l.id, kind: l.kind, title: l.title, date: l.quiz_date })
      }
      const classLinks = db
        .prepare(
          `SELECT lc.lesson_id, c.id, c.course, c.section, c.period, t.name AS term_name
           FROM lesson_classes lc
             JOIN classes c ON c.id = lc.class_id JOIN terms t ON t.id = c.term_id
           WHERE lc.lesson_id IN (${marks})
           ORDER BY t.is_current DESC, t.start_date DESC, c.course COLLATE NOCASE, c.period, c.section, c.id`
        )
        .all(...ids) as ClassLinkRow[]
      for (const l of classLinks) {
        push(classesBy, l.lesson_id, {
          id: l.id,
          course: l.course,
          section: l.section,
          period: l.period,
          termName: l.term_name
        })
      }
      const assignmentLinks = db
        .prepare(
          `SELECT la.lesson_id, a.id, a.class_id, a.title, a.points_possible, a.due_date
           FROM lesson_assignments la JOIN assignments a ON a.id = la.assignment_id
           WHERE la.lesson_id IN (${marks})
           ORDER BY a.class_id, a.sort_order, a.id`
        )
        .all(...ids) as AssignmentLinkRow[]
      for (const l of assignmentLinks) {
        push(assignmentsBy, l.lesson_id, {
          id: l.id,
          classId: l.class_id,
          title: l.title,
          pointsPossible: l.points_possible,
          dueDate: l.due_date
        })
      }
      const blocks = db
        .prepare(
          `SELECT * FROM lesson_blocks WHERE lesson_id IN (${marks}) ORDER BY lesson_id, position, id`
        )
        .all(...ids) as BlockRow[]
      for (const b of blocks) push(blocksBy, b.lesson_id, toBlock(b))
      const tasks = db
        .prepare(
          `SELECT * FROM lesson_tasks WHERE lesson_id IN (${marks}) ORDER BY lesson_id, position, id`
        )
        .all(...ids) as TaskRow[]
      for (const t of tasks) push(tasksBy, t.lesson_id, toTask(t))
    }
    return rows.map((r) => ({
      id: r.id,
      unitId: r.unit_id,
      position: r.position,
      title: r.title,
      date: r.lesson_date,
      objectives: r.objectives,
      plan: r.plan,
      homework: r.homework,
      notes: r.notes,
      quizzes: quizzesBy.get(r.id) ?? [],
      classes: classesBy.get(r.id) ?? [],
      assignments: assignmentsBy.get(r.id) ?? [],
      classMinutes: r.class_minutes,
      blocks: blocksBy.get(r.id) ?? [],
      tasks: tasksBy.get(r.id) ?? []
    }))
  }
  const lessonsOf = (unitId: number): Lesson[] =>
    withLinks(
      db
        .prepare('SELECT * FROM lessons WHERE unit_id = ? ORDER BY position, id')
        .all(unitId) as LessonRow[]
    )
  const detail = (id: number): UnitDetail => ({ ...mustUnit(id), lessons: lessonsOf(id) })

  const getLesson = (id: number): Lesson | null => {
    const r = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined
    return r ? withLinks([r])[0] : null
  }
  const mustLesson = (id: number): Lesson => {
    const l = getLesson(id)
    if (!l) throw new v.ValidationError('That lesson no longer exists')
    return l
  }
  const renumber = (unitId: number): void => {
    const ids = db
      .prepare('SELECT id FROM lessons WHERE unit_id = ? ORDER BY position, id')
      .all(unitId) as { id: number }[]
    const set = db.prepare('UPDATE lessons SET position = ? WHERE id = ?')
    ids.forEach((r, i) => set.run(i, r.id))
  }

  /** Links to attached files are not foreign keys, so they are cleared by hand with the record. */
  const clearLessonLinks = (where: string, ...params: unknown[]): number =>
    db
      .prepare(
        `DELETE FROM file_links WHERE record_type = 'lesson'
           AND record_id IN (SELECT id FROM lessons WHERE ${where})`
      )
      .run(...params).changes

  /**
   * Copies one lesson row into a unit at a position, with the same quizzes linked and the same files
   * attached (a quiz is shared, not copied), and its blocks and prep tasks, the tasks not done yet.
   * Returns the new lesson and how many file links were made.
   */
  const copyLesson = (
    row: LessonRow,
    unitId: number,
    position: number,
    title: string,
    dates: CopyDates
  ): { id: number; links: number } => {
    const res = db
      .prepare(
        `INSERT INTO lessons (unit_id, position, title, lesson_date, objectives, plan, homework, notes,
           class_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        unitId,
        position,
        title,
        copiedDate(row.lesson_date, dates),
        row.objectives,
        row.plan,
        row.homework,
        row.notes,
        row.class_minutes
      )
    const newId = Number(res.lastInsertRowid)
    // Each block's tasks follow it to its copy; a task added by hand has no block.
    const blockIds = new Map<number, number>()
    const blocks = db
      .prepare('SELECT * FROM lesson_blocks WHERE lesson_id = ? ORDER BY position, id')
      .all(row.id) as BlockRow[]
    const addBlock = db.prepare(
      'INSERT INTO lesson_blocks (lesson_id, position, kind, title, minutes, details) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const b of blocks) {
      const made = addBlock.run(newId, b.position, b.kind, b.title, b.minutes, b.details)
      blockIds.set(b.id, Number(made.lastInsertRowid))
    }
    const tasks = db
      .prepare('SELECT * FROM lesson_tasks WHERE lesson_id = ? ORDER BY position, id')
      .all(row.id) as TaskRow[]
    const addTask = db.prepare(
      'INSERT INTO lesson_tasks (lesson_id, block_id, position, text, done) VALUES (?, ?, ?, ?, 0)'
    )
    for (const t of tasks) {
      addTask.run(
        newId,
        t.block_id === null ? null : (blockIds.get(t.block_id) ?? null),
        t.position,
        t.text
      )
    }
    db.prepare(
      'INSERT INTO lesson_quizzes (lesson_id, quiz_id) SELECT ?, quiz_id FROM lesson_quizzes WHERE lesson_id = ?'
    ).run(newId, row.id)
    const links = db
      .prepare(
        `INSERT OR IGNORE INTO file_links (path, record_type, record_id)
         SELECT path, 'lesson', ? FROM file_links WHERE record_type = 'lesson' AND record_id = ?`
      )
      .run(newId, row.id).changes
    return { id: newId, links }
  }
  const lessonRow = (id: number): LessonRow => {
    const r = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined
    if (!r) throw new v.ValidationError('That lesson no longer exists')
    return r
  }
  const lessonCount = (unitId: number): number =>
    (
      db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE unit_id = ?').get(unitId) as {
        n: number
      }
    ).n

  const blockRow = (id: number): BlockRow => {
    const r = db.prepare('SELECT * FROM lesson_blocks WHERE id = ?').get(id) as BlockRow | undefined
    if (!r) throw new v.ValidationError('That part of the lesson no longer exists')
    return r
  }
  const taskRow = (id: number): TaskRow => {
    const r = db.prepare('SELECT * FROM lesson_tasks WHERE id = ?').get(id) as TaskRow | undefined
    if (!r) throw new v.ValidationError('That task no longer exists')
    return r
  }
  const renumberBlocks = (lessonId: number): void => {
    const ids = db
      .prepare('SELECT id FROM lesson_blocks WHERE lesson_id = ? ORDER BY position, id')
      .all(lessonId) as { id: number }[]
    const set = db.prepare('UPDATE lesson_blocks SET position = ? WHERE id = ?')
    ids.forEach((r, i) => set.run(i, r.id))
  }
  const renumberTasks = (lessonId: number): void => {
    const ids = db
      .prepare('SELECT id FROM lesson_tasks WHERE lesson_id = ? ORDER BY position, id')
      .all(lessonId) as { id: number }[]
    const set = db.prepare('UPDATE lesson_tasks SET position = ? WHERE id = ?')
    ids.forEach((r, i) => set.run(i, r.id))
  }
  const countOf = (table: 'lesson_blocks' | 'lesson_tasks', lessonId: number): number =>
    (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE lesson_id = ?`).get(lessonId) as {
        n: number
      }
    ).n
  const appendTask = (
    lessonId: number,
    blockId: number | null,
    text: string,
    done = false
  ): void => {
    db.prepare(
      `INSERT INTO lesson_tasks (lesson_id, block_id, position, text, done)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM lesson_tasks WHERE lesson_id = ?), ?, ?)`
    ).run(lessonId, blockId, lessonId, text, done ? 1 : 0)
  }

  return {
    units: {
      list(): UnitSummary[] {
        const rows = db
          .prepare(
            `SELECT u.*,
               (SELECT COUNT(*) FROM lessons l WHERE l.unit_id = u.id) AS lesson_count,
               (SELECT MIN(l.lesson_date) FROM lessons l WHERE l.unit_id = u.id) AS first_date,
               (SELECT MAX(l.lesson_date) FROM lessons l WHERE l.unit_id = u.id) AS last_date
             FROM units u`
          )
          .all() as SummaryRow[]
        // By course, then by when the unit starts (undated units last), then in the order made.
        return rows
          .sort(
            (a, b) =>
              a.course.localeCompare(b.course, undefined, { sensitivity: 'base' }) ||
              (a.first_date ?? '9999').localeCompare(b.first_date ?? '9999') ||
              a.id - b.id
          )
          .map((r) => ({
            ...toUnit(r),
            lessonCount: r.lesson_count,
            firstDate: r.first_date,
            lastDate: r.last_date
          }))
      },

      get(rawId: number): UnitDetail | null {
        const id = v.id(rawId)
        return getUnit(id) ? detail(id) : null
      },

      create(input: UnitInput): UnitDetail {
        const res = db
          .prepare('INSERT INTO units (title, course, summary, term_id) VALUES (?, ?, ?, ?)')
          .run(
            v.reqStr(input?.title, 'Title', 200),
            v.optStr(input.course, 'Course', 200),
            v.optStr(input.summary, 'Summary', MAX_TEXT),
            termOrNull(input.termId)
          )
        emit('planner.changed')
        return detail(Number(res.lastInsertRowid))
      },

      update(rawId: number, patch: Partial<UnitInput>): UnitDetail {
        const id = v.id(rawId)
        const cur = mustUnit(id)
        db.prepare(
          'UPDATE units SET title = ?, course = ?, summary = ?, term_id = ? WHERE id = ?'
        ).run(
          patch.title !== undefined ? v.reqStr(patch.title, 'Title', 200) : cur.title,
          patch.course !== undefined ? v.optStr(patch.course, 'Course', 200) : cur.course,
          patch.summary !== undefined ? v.optStr(patch.summary, 'Summary', MAX_TEXT) : cur.summary,
          patch.termId !== undefined ? termOrNull(patch.termId) : cur.termId,
          id
        )
        emit('planner.changed')
        return detail(id)
      },

      /** Its lessons go with it, and so do their attached-file links. Quizzes are not touched. */
      delete(rawId: number): void {
        const id = v.id(rawId)
        mustUnit(id)
        const cleared = db.transaction(() => {
          const lessonLinks = clearLessonLinks('unit_id = ?', id)
          const unitLinks = db
            .prepare("DELETE FROM file_links WHERE record_type = 'unit' AND record_id = ?")
            .run(id).changes
          db.prepare('DELETE FROM units WHERE id = ?').run(id)
          return lessonLinks + unitLinks
        })()
        emit('planner.changed')
        if (cleared > 0) emit('fileLinks.changed')
      },

      /** A new unit with its lessons copied in order, for planning the same course again. */
      duplicate(rawId: number, options?: UnitCopyInput): UnitDetail {
        const id = v.id(rawId)
        const source = mustUnit(id)
        const title =
          options?.title !== undefined
            ? v.reqStr(options.title, 'Title', 200)
            : copyTitle(source.title)
        const dates = copyDates(options?.dates)
        const { newId, linked } = db.transaction(() => {
          const res = db
            .prepare('INSERT INTO units (title, course, summary) VALUES (?, ?, ?)')
            .run(title, source.course, source.summary)
          const made = Number(res.lastInsertRowid)
          let links = db
            .prepare(
              `INSERT OR IGNORE INTO file_links (path, record_type, record_id)
               SELECT path, 'unit', ? FROM file_links WHERE record_type = 'unit' AND record_id = ?`
            )
            .run(made, id).changes
          const lessons = db
            .prepare('SELECT * FROM lessons WHERE unit_id = ? ORDER BY position, id')
            .all(id) as LessonRow[]
          lessons.forEach((l, i) => {
            links += copyLesson(l, made, i, l.title, dates).links
          })
          return { newId: made, linked: links }
        })()
        emit('planner.changed')
        if (linked > 0) emit('fileLinks.changed')
        return detail(newId)
      },

      reorder(rawId: number, rawLessonIds: number[]): UnitDetail {
        const id = v.id(rawId)
        mustUnit(id)
        if (!Array.isArray(rawLessonIds)) throw new v.ValidationError('Lessons must be a list')
        if (rawLessonIds.length > MAX_LESSONS) {
          throw new v.ValidationError('That is too many lessons')
        }
        const ids = rawLessonIds.map((x) => v.id(x, 'Lesson'))
        const current = (
          db.prepare('SELECT id FROM lessons WHERE unit_id = ?').all(id) as { id: number }[]
        ).map((r) => r.id)
        // The new order must be exactly the lessons already in the unit: no more, no fewer, no repeats.
        if (
          new Set(ids).size !== ids.length ||
          ids.length !== current.length ||
          !current.every((l) => ids.includes(l))
        ) {
          throw new v.ValidationError('The new order must list each lesson in the unit once')
        }
        db.transaction(() => {
          const set = db.prepare('UPDATE lessons SET position = ? WHERE id = ?')
          ids.forEach((lessonId, i) => set.run(i, lessonId))
        })()
        emit('planner.changed')
        return detail(id)
      },

      /** Lessons dated today or later, soonest first. */
      upcoming(): UpcomingLesson[] {
        const rows = db
          .prepare(
            `SELECT l.*, u.title AS unit_title, u.course AS unit_course
             FROM lessons l JOIN units u ON u.id = l.unit_id
             WHERE l.lesson_date IS NOT NULL AND l.lesson_date >= ?
             ORDER BY l.lesson_date, u.course COLLATE NOCASE, u.id, l.position
             LIMIT ?`
          )
          .all(today(), UPCOMING_LIMIT) as (LessonRow & {
          unit_title: string
          unit_course: string
        })[]
        const lessons = withLinks(rows)
        return rows.map((r, i) => ({
          lesson: lessons[i],
          unitTitle: r.unit_title,
          course: r.unit_course
        }))
      },

      /** A semester's units in the order they are taught (by first lesson date, undated last). */
      roadmap(rawTermId: number | null): UnitDetail[] {
        const termId = rawTermId === null ? null : v.id(rawTermId, 'Semester')
        const rows = db
          .prepare(
            `SELECT u.*, (SELECT MIN(l.lesson_date) FROM lessons l WHERE l.unit_id = u.id) AS first_date
             FROM units u WHERE u.term_id IS ?
             ORDER BY COALESCE(first_date, '9999'), u.course COLLATE NOCASE, u.id`
          )
          .all(termId) as (UnitRow & { first_date: string | null })[]
        if (rows.length === 0) return []
        const marks = rows.map(() => '?').join(', ')
        const lessons = withLinks(
          db
            .prepare(
              `SELECT * FROM lessons WHERE unit_id IN (${marks}) ORDER BY unit_id, position, id`
            )
            .all(...rows.map((r) => r.id)) as LessonRow[]
        )
        return rows.map((r) => ({
          ...toUnit(r),
          lessons: lessons.filter((l) => l.unitId === r.id)
        }))
      },

      /**
       * Prep for every lesson, soonest lesson first (undated last), in the order the lesson lists
       * it. Done tasks only when asked for, and then only the most recent few hundred.
       */
      todo(includeDone?: boolean): TodoItem[] {
        const rows = db
          .prepare(
            `SELECT t.*, l.title AS lesson_title, l.lesson_date, l.position AS lesson_position,
               u.id AS unit_id, u.title AS unit_title, u.course,
               b.kind AS block_kind, b.title AS block_title
             FROM lesson_tasks t
               JOIN lessons l ON l.id = t.lesson_id
               JOIN units u ON u.id = l.unit_id
               LEFT JOIN lesson_blocks b ON b.id = t.block_id
             WHERE t.done = 0
             ORDER BY COALESCE(l.lesson_date, '9999'), u.course COLLATE NOCASE, u.id,
               l.position, t.position, t.id`
          )
          .all() as TodoRow[]
        const done =
          includeDone === true
            ? (db
                .prepare(
                  `SELECT t.*, l.title AS lesson_title, l.lesson_date, l.position AS lesson_position,
                     u.id AS unit_id, u.title AS unit_title, u.course,
                     b.kind AS block_kind, b.title AS block_title
                   FROM lesson_tasks t
                     JOIN lessons l ON l.id = t.lesson_id
                     JOIN units u ON u.id = l.unit_id
                     LEFT JOIN lesson_blocks b ON b.id = t.block_id
                   WHERE t.done = 1
                   ORDER BY COALESCE(l.lesson_date, '0000') DESC, t.id DESC
                   LIMIT ?`
                )
                .all(DONE_LIMIT) as TodoRow[])
            : []
        return [...rows, ...done].map((r) => ({
          ...toTask(r),
          lessonTitle: r.lesson_title,
          lessonDate: r.lesson_date,
          unitId: r.unit_id,
          unitTitle: r.unit_title,
          course: r.course,
          blockKind: r.block_kind,
          blockTitle: r.block_title
        }))
      }
    },

    lessons: {
      create(input: LessonInput): Lesson {
        const unitId = v.id(input?.unitId, 'unitId')
        mustUnit(unitId)
        const title = v.reqStr(input.title, 'Title', 200)
        const date = v.dateOrNull(input.date, 'Date')
        const objectives = v.optStr(input.objectives, 'Objectives', MAX_TEXT)
        const plan = v.optStr(input.plan, 'Plan', MAX_PLAN)
        const homework = v.optStr(input.homework, 'Homework', MAX_TEXT)
        const notes = v.optStr(input.notes, 'Notes', MAX_TEXT)
        const classMinutes = minutesOrNull(input.classMinutes, 'Class length', 1)
        const count = (
          db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE unit_id = ?').get(unitId) as {
            n: number
          }
        ).n
        if (count >= MAX_LESSONS) throw new v.ValidationError('That unit has too many lessons')
        const res = db
          .prepare(
            `INSERT INTO lessons (unit_id, position, title, lesson_date, objectives, plan, homework, notes,
               class_minutes)
             VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM lessons WHERE unit_id = ?), ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(unitId, unitId, title, date, objectives, plan, homework, notes, classMinutes)
        emit('planner.changed')
        return mustLesson(Number(res.lastInsertRowid))
      },

      update(rawId: number, patch: Partial<Omit<LessonInput, 'unitId'>>): Lesson {
        const id = v.id(rawId)
        const cur = mustLesson(id)
        db.prepare(
          `UPDATE lessons SET title = ?, lesson_date = ?, objectives = ?, plan = ?, homework = ?, notes = ?,
             class_minutes = ?
           WHERE id = ?`
        ).run(
          patch.title !== undefined ? v.reqStr(patch.title, 'Title', 200) : cur.title,
          patch.date !== undefined ? v.dateOrNull(patch.date, 'Date') : cur.date,
          patch.objectives !== undefined
            ? v.optStr(patch.objectives, 'Objectives', MAX_TEXT)
            : cur.objectives,
          patch.plan !== undefined ? v.optStr(patch.plan, 'Plan', MAX_PLAN) : cur.plan,
          patch.homework !== undefined
            ? v.optStr(patch.homework, 'Homework', MAX_TEXT)
            : cur.homework,
          patch.notes !== undefined ? v.optStr(patch.notes, 'Notes', MAX_TEXT) : cur.notes,
          patch.classMinutes !== undefined
            ? minutesOrNull(patch.classMinutes, 'Class length', 1)
            : cur.classMinutes,
          id
        )
        emit('planner.changed')
        return mustLesson(id)
      },

      delete(rawId: number): void {
        const id = v.id(rawId)
        const lesson = mustLesson(id)
        const cleared = db.transaction(() => {
          const links = clearLessonLinks('id = ?', id)
          db.prepare('DELETE FROM lessons WHERE id = ?').run(id)
          renumber(lesson.unitId)
          return links
        })()
        emit('planner.changed')
        if (cleared > 0) emit('fileLinks.changed')
      },

      /** Copied to just after the original; its quizzes and files come too, its date does not by default. */
      duplicate(rawId: number, options?: LessonCopyInput): Lesson {
        const id = v.id(rawId)
        const source = lessonRow(id)
        const dates = copyDates(options?.dates)
        if (lessonCount(source.unit_id) >= MAX_LESSONS) {
          throw new v.ValidationError('That unit has too many lessons')
        }
        const { newId, linked } = db.transaction(() => {
          db.prepare(
            'UPDATE lessons SET position = position + 1 WHERE unit_id = ? AND position > ?'
          ).run(source.unit_id, source.position)
          const copy = copyLesson(
            source,
            source.unit_id,
            source.position + 1,
            copyTitle(source.title),
            dates
          )
          renumber(source.unit_id)
          return { newId: copy.id, linked: copy.links }
        })()
        emit('planner.changed')
        if (linked > 0) emit('fileLinks.changed')
        return mustLesson(newId)
      },

      /** To the end of another unit. Its quizzes and attached files stay with it. */
      move(rawId: number, rawUnitId: number): Lesson {
        const id = v.id(rawId)
        const unitId = v.id(rawUnitId, 'Unit')
        const source = lessonRow(id)
        mustUnit(unitId)
        if (unitId === source.unit_id) {
          throw new v.ValidationError('That lesson is already in this unit')
        }
        if (lessonCount(unitId) >= MAX_LESSONS) {
          throw new v.ValidationError('That unit has too many lessons')
        }
        db.transaction(() => {
          db.prepare(
            `UPDATE lessons SET unit_id = ?,
               position = (SELECT COALESCE(MAX(position), -1) + 1 FROM lessons WHERE unit_id = ?)
             WHERE id = ?`
          ).run(unitId, unitId, id)
          renumber(source.unit_id)
        })()
        emit('planner.changed')
        return mustLesson(id)
      },

      /** Quizzes can be used by more than one lesson (a review, say). Linking twice is harmless. */
      linkQuiz(rawId: number, rawQuizId: number): Lesson {
        const id = v.id(rawId)
        const quizId = v.id(rawQuizId, 'Quiz')
        mustLesson(id)
        if (!db.prepare('SELECT 1 FROM quizzes WHERE id = ?').get(quizId)) {
          throw new v.ValidationError('That quiz no longer exists')
        }
        db.prepare('INSERT OR IGNORE INTO lesson_quizzes (lesson_id, quiz_id) VALUES (?, ?)').run(
          id,
          quizId
        )
        emit('planner.changed')
        return mustLesson(id)
      },

      /** The classes a lesson is taught to. Linking twice is harmless. */
      linkClass(rawId: number, rawClassId: number): Lesson {
        const id = v.id(rawId)
        const classId = v.id(rawClassId, 'Class')
        mustLesson(id)
        if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(classId)) {
          throw new v.ValidationError('That class no longer exists')
        }
        db.prepare('INSERT OR IGNORE INTO lesson_classes (lesson_id, class_id) VALUES (?, ?)').run(
          id,
          classId
        )
        emit('planner.changed')
        return mustLesson(id)
      },

      /** Also drops the lesson's links to that class's assignments, which would otherwise be left dangling. */
      unlinkClass(rawId: number, rawClassId: number): Lesson {
        const id = v.id(rawId)
        const classId = v.id(rawClassId, 'Class')
        mustLesson(id)
        db.transaction(() => {
          db.prepare(
            `DELETE FROM lesson_assignments WHERE lesson_id = ?
               AND assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)`
          ).run(id, classId)
          db.prepare('DELETE FROM lesson_classes WHERE lesson_id = ? AND class_id = ?').run(
            id,
            classId
          )
        })()
        emit('planner.changed')
        return mustLesson(id)
      },

      /** An assignment can only be linked once its class is, so every link has a class to sit under. */
      linkAssignment(rawId: number, rawAssignmentId: number): Lesson {
        const id = v.id(rawId)
        const assignmentId = v.id(rawAssignmentId, 'Assignment')
        mustLesson(id)
        const a = db.prepare('SELECT class_id FROM assignments WHERE id = ?').get(assignmentId) as
          { class_id: number } | undefined
        if (!a) throw new v.ValidationError('That assignment no longer exists')
        if (
          !db
            .prepare('SELECT 1 FROM lesson_classes WHERE lesson_id = ? AND class_id = ?')
            .get(id, a.class_id)
        ) {
          throw new v.ValidationError('Link the lesson to that assignment’s class first')
        }
        db.prepare(
          'INSERT OR IGNORE INTO lesson_assignments (lesson_id, assignment_id) VALUES (?, ?)'
        ).run(id, assignmentId)
        emit('planner.changed')
        return mustLesson(id)
      },

      unlinkAssignment(rawId: number, rawAssignmentId: number): Lesson {
        const id = v.id(rawId)
        const assignmentId = v.id(rawAssignmentId, 'Assignment')
        mustLesson(id)
        db.prepare('DELETE FROM lesson_assignments WHERE lesson_id = ? AND assignment_id = ?').run(
          id,
          assignmentId
        )
        emit('planner.changed')
        return mustLesson(id)
      },

      unlinkQuiz(rawId: number, rawQuizId: number): Lesson {
        const id = v.id(rawId)
        const quizId = v.id(rawQuizId, 'Quiz')
        mustLesson(id)
        db.prepare('DELETE FROM lesson_quizzes WHERE lesson_id = ? AND quiz_id = ?').run(id, quizId)
        emit('planner.changed')
        return mustLesson(id)
      },

      /** A new block, at the end or at a given place, with the prep its kind needs added as tasks. */
      addBlock(rawId: number, input: BlockInput): Lesson {
        const id = v.id(rawId)
        mustLesson(id)
        const kind = v.oneOf(input?.kind, BLOCK_KINDS, 'Kind')
        const info = BLOCK_INFO[kind]
        const title = input.title !== undefined ? v.optStr(input.title, 'Title', 200) : info.label
        const minutes =
          input.minutes !== undefined ? minutesOrNull(input.minutes, 'Minutes') : info.minutes
        const details = v.optStr(input.details, 'Details', MAX_TEXT)
        const count = countOf('lesson_blocks', id)
        if (count >= MAX_BLOCKS) throw new v.ValidationError('That lesson has too many parts')
        if (countOf('lesson_tasks', id) + info.tasks.length > MAX_TASKS) {
          throw new v.ValidationError('That lesson has too many tasks')
        }
        let position = count
        if (input.position !== undefined) {
          const p = v.num(input.position, 'Position')
          position = Number.isInteger(p) ? Math.min(p, count) : count
        }
        db.transaction(() => {
          db.prepare(
            'UPDATE lesson_blocks SET position = position + 1 WHERE lesson_id = ? AND position >= ?'
          ).run(id, position)
          const made = db
            .prepare(
              'INSERT INTO lesson_blocks (lesson_id, position, kind, title, minutes, details) VALUES (?, ?, ?, ?, ?, ?)'
            )
            .run(id, position, kind, title, minutes, details)
          const blockId = Number(made.lastInsertRowid)
          for (const text of info.tasks) appendTask(id, blockId, text)
          renumberBlocks(id)
        })()
        emit('planner.changed')
        return mustLesson(id)
      },

      updateBlock(
        rawBlockId: number,
        patch: Partial<Omit<BlockInput, 'kind' | 'position'>>
      ): Lesson {
        const cur = blockRow(v.id(rawBlockId))
        db.prepare('UPDATE lesson_blocks SET title = ?, minutes = ?, details = ? WHERE id = ?').run(
          patch?.title !== undefined ? v.optStr(patch.title, 'Title', 200) : cur.title,
          patch?.minutes !== undefined ? minutesOrNull(patch.minutes, 'Minutes') : cur.minutes,
          patch?.details !== undefined ? v.optStr(patch.details, 'Details', MAX_TEXT) : cur.details,
          cur.id
        )
        emit('planner.changed')
        return mustLesson(cur.lesson_id)
      },

      /** Its prep tasks go with it, done or not. */
      deleteBlock(rawBlockId: number): Lesson {
        const cur = blockRow(v.id(rawBlockId))
        db.transaction(() => {
          db.prepare('DELETE FROM lesson_blocks WHERE id = ?').run(cur.id)
          renumberBlocks(cur.lesson_id)
          renumberTasks(cur.lesson_id)
        })()
        emit('planner.changed')
        return mustLesson(cur.lesson_id)
      },

      reorderBlocks(rawId: number, rawBlockIds: number[]): Lesson {
        const id = v.id(rawId)
        mustLesson(id)
        if (!Array.isArray(rawBlockIds) || rawBlockIds.length > MAX_BLOCKS) {
          throw new v.ValidationError('The new order must list each part of the lesson once')
        }
        const ids = rawBlockIds.map((x) => v.id(x, 'Block'))
        const current = (
          db.prepare('SELECT id FROM lesson_blocks WHERE lesson_id = ?').all(id) as { id: number }[]
        ).map((r) => r.id)
        if (
          new Set(ids).size !== ids.length ||
          ids.length !== current.length ||
          !current.every((b) => ids.includes(b))
        ) {
          throw new v.ValidationError('The new order must list each part of the lesson once')
        }
        db.transaction(() => {
          const set = db.prepare('UPDATE lesson_blocks SET position = ? WHERE id = ?')
          ids.forEach((blockId, i) => set.run(i, blockId))
        })()
        emit('planner.changed')
        return mustLesson(id)
      },

      /** A task of the teacher's own, not tied to a block. */
      addTask(rawId: number, input: TaskInput): Lesson {
        const id = v.id(rawId)
        mustLesson(id)
        const text = v.reqStr(input?.text, 'Task', 300)
        if (countOf('lesson_tasks', id) >= MAX_TASKS) {
          throw new v.ValidationError('That lesson has too many tasks')
        }
        appendTask(id, null, text, input.done === true)
        emit('planner.changed')
        return mustLesson(id)
      },

      updateTask(rawTaskId: number, patch: Partial<TaskInput>): Lesson {
        const cur = taskRow(v.id(rawTaskId))
        if (patch?.done !== undefined && typeof patch.done !== 'boolean') {
          throw new v.ValidationError('Done must be true or false')
        }
        db.prepare('UPDATE lesson_tasks SET text = ?, done = ? WHERE id = ?').run(
          patch?.text !== undefined ? v.reqStr(patch.text, 'Task', 300) : cur.text,
          patch?.done !== undefined ? (patch.done ? 1 : 0) : cur.done,
          cur.id
        )
        emit('planner.changed')
        return mustLesson(cur.lesson_id)
      },

      deleteTask(rawTaskId: number): Lesson {
        const cur = taskRow(v.id(rawTaskId))
        db.transaction(() => {
          db.prepare('DELETE FROM lesson_tasks WHERE id = ?').run(cur.id)
          renumberTasks(cur.lesson_id)
        })()
        emit('planner.changed')
        return mustLesson(cur.lesson_id)
      }
    }
  }
}
