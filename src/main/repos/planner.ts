import { localToday } from '@shared/advising'
import type { LessonInput, UnitInput } from '@shared/api'
import { MAX_LESSONS, UPCOMING_LIMIT } from '@shared/lesson'
import type {
  Lesson,
  LinkedQuiz,
  QuizKind,
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
}
interface QuizLinkRow {
  lesson_id: number
  id: number
  kind: QuizKind
  title: string
  quiz_date: string | null
}

const toUnit = (r: UnitRow): Unit => ({
  id: r.id,
  title: r.title,
  course: r.course,
  summary: r.summary
})

// A lesson's plan can run to a page of steps; the rest are short.
const MAX_PLAN = 20000
const MAX_TEXT = 10000

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

  /** Attaches each lesson's quizzes with one query, whatever the number of lessons. */
  const withQuizzes = (rows: LessonRow[]): Lesson[] => {
    const byLesson = new Map<number, LinkedQuiz[]>()
    if (rows.length > 0) {
      const marks = rows.map(() => '?').join(', ')
      const links = db
        .prepare(
          `SELECT lq.lesson_id, z.id, z.kind, z.title, z.quiz_date
           FROM lesson_quizzes lq JOIN quizzes z ON z.id = lq.quiz_id
           WHERE lq.lesson_id IN (${marks})
           ORDER BY COALESCE(z.quiz_date, '9999'), z.id`
        )
        .all(...rows.map((r) => r.id)) as QuizLinkRow[]
      for (const l of links) {
        const list = byLesson.get(l.lesson_id) ?? []
        list.push({ id: l.id, kind: l.kind, title: l.title, date: l.quiz_date })
        byLesson.set(l.lesson_id, list)
      }
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
      quizzes: byLesson.get(r.id) ?? []
    }))
  }
  const lessonsOf = (unitId: number): Lesson[] =>
    withQuizzes(
      db
        .prepare('SELECT * FROM lessons WHERE unit_id = ? ORDER BY position, id')
        .all(unitId) as LessonRow[]
    )
  const detail = (id: number): UnitDetail => ({ ...mustUnit(id), lessons: lessonsOf(id) })

  const getLesson = (id: number): Lesson | null => {
    const r = db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined
    return r ? withQuizzes([r])[0] : null
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
          .prepare('INSERT INTO units (title, course, summary) VALUES (?, ?, ?)')
          .run(
            v.reqStr(input?.title, 'Title', 200),
            v.optStr(input.course, 'Course', 200),
            v.optStr(input.summary, 'Summary', MAX_TEXT)
          )
        emit('planner.changed')
        return detail(Number(res.lastInsertRowid))
      },

      update(rawId: number, patch: Partial<UnitInput>): UnitDetail {
        const id = v.id(rawId)
        const cur = mustUnit(id)
        db.prepare('UPDATE units SET title = ?, course = ?, summary = ? WHERE id = ?').run(
          patch.title !== undefined ? v.reqStr(patch.title, 'Title', 200) : cur.title,
          patch.course !== undefined ? v.optStr(patch.course, 'Course', 200) : cur.course,
          patch.summary !== undefined ? v.optStr(patch.summary, 'Summary', MAX_TEXT) : cur.summary,
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
        const lessons = withQuizzes(rows)
        return rows.map((r, i) => ({
          lesson: lessons[i],
          unitTitle: r.unit_title,
          course: r.unit_course
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
        const count = (
          db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE unit_id = ?').get(unitId) as {
            n: number
          }
        ).n
        if (count >= MAX_LESSONS) throw new v.ValidationError('That unit has too many lessons')
        const res = db
          .prepare(
            `INSERT INTO lessons (unit_id, position, title, lesson_date, objectives, plan, homework, notes)
             VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM lessons WHERE unit_id = ?), ?, ?, ?, ?, ?, ?)`
          )
          .run(unitId, unitId, title, date, objectives, plan, homework, notes)
        emit('planner.changed')
        return mustLesson(Number(res.lastInsertRowid))
      },

      update(rawId: number, patch: Partial<Omit<LessonInput, 'unitId'>>): Lesson {
        const id = v.id(rawId)
        const cur = mustLesson(id)
        db.prepare(
          `UPDATE lessons SET title = ?, lesson_date = ?, objectives = ?, plan = ?, homework = ?, notes = ?
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

      unlinkQuiz(rawId: number, rawQuizId: number): Lesson {
        const id = v.id(rawId)
        const quizId = v.id(rawQuizId, 'Quiz')
        mustLesson(id)
        db.prepare('DELETE FROM lesson_quizzes WHERE lesson_id = ? AND quiz_id = ?').run(id, quizId)
        emit('planner.changed')
        return mustLesson(id)
      }
    }
  }
}
