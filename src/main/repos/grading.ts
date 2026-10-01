import type { AssignmentInput, CategoryInput, ScoreInput } from '@shared/api'
import type { Assignment, GradeCategory, Score, ScoreStatus } from '@shared/models'
import * as v from '../validate'
import type { Db, Emit } from './types'

interface CategoryRow {
  id: number
  class_id: number
  name: string
  weight: number
  sort_order: number
}
interface AssignmentRow {
  id: number
  class_id: number
  category_id: number | null
  title: string
  points_possible: number
  due_date: string | null
  source_app: string | null
  source_id: string | null
  sort_order: number
}
interface ScoreRow {
  id: number
  assignment_id: number
  student_id: number
  points: number | null
  status: ScoreStatus | null
  comment: string
}

const toCategory = (r: CategoryRow): GradeCategory => ({
  id: r.id,
  classId: r.class_id,
  name: r.name,
  weight: r.weight,
  sortOrder: r.sort_order
})
const toAssignment = (r: AssignmentRow): Assignment => ({
  id: r.id,
  classId: r.class_id,
  categoryId: r.category_id,
  title: r.title,
  pointsPossible: r.points_possible,
  dueDate: r.due_date,
  sourceApp: r.source_app,
  sourceId: r.source_id,
  sortOrder: r.sort_order
})
const toScore = (r: ScoreRow): Score => ({
  id: r.id,
  assignmentId: r.assignment_id,
  studentId: r.student_id,
  points: r.points,
  status: r.status,
  comment: r.comment
})

const STATUSES = ['missing', 'excused', 'late'] as const

export function gradingRepo(db: Db, emit: Emit) {
  const classExists = (id: number): void => {
    if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(id)) {
      throw new v.ValidationError('That class no longer exists')
    }
  }
  const categoryFor = (categoryId: unknown, classId: number): number | null => {
    if (categoryId == null) return null
    const cid = v.id(categoryId, 'Category')
    const row = db.prepare('SELECT class_id FROM grade_categories WHERE id = ?').get(cid) as
      { class_id: number } | undefined
    if (!row || row.class_id !== classId)
      throw new v.ValidationError('That category belongs to a different class')
    return cid
  }
  const mustCategory = (id: number): GradeCategory => {
    const r = db.prepare('SELECT * FROM grade_categories WHERE id = ?').get(id) as
      CategoryRow | undefined
    if (!r) throw new v.ValidationError('That category no longer exists')
    return toCategory(r)
  }
  const mustAssignment = (id: number): Assignment => {
    const r = db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as
      AssignmentRow | undefined
    if (!r) throw new v.ValidationError('That assignment no longer exists')
    return toAssignment(r)
  }

  /** Validates and writes one score. Returns the classId touched and the saved row (null if cleared). */
  const writeScore = (input: ScoreInput): { classId: number; score: Score | null } => {
    const assignmentId = v.id(input?.assignmentId, 'assignmentId')
    const studentId = v.id(input.studentId, 'studentId')
    const assignment = mustAssignment(assignmentId)
    const enrolled = db
      .prepare('SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ?')
      .get(assignment.classId, studentId)
    if (!enrolled) throw new v.ValidationError('That student is not enrolled in this class')
    const points = input.points == null ? null : v.num(input.points, 'Points', 0)
    const status = input.status == null ? null : v.oneOf(input.status, STATUSES, 'Status')
    const comment = v.optStr(input.comment, 'Comment', 2000)

    if (points === null && status === null && comment === '') {
      db.prepare('DELETE FROM scores WHERE assignment_id = ? AND student_id = ?').run(
        assignmentId,
        studentId
      )
      return { classId: assignment.classId, score: null }
    }
    db.prepare(
      `INSERT INTO scores (assignment_id, student_id, points, status, comment) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (assignment_id, student_id)
       DO UPDATE SET points = excluded.points, status = excluded.status, comment = excluded.comment`
    ).run(assignmentId, studentId, points, status, comment)
    const row = db
      .prepare('SELECT * FROM scores WHERE assignment_id = ? AND student_id = ?')
      .get(assignmentId, studentId) as ScoreRow
    return { classId: assignment.classId, score: toScore(row) }
  }

  return {
    categories(rawClassId: number): GradeCategory[] {
      const rows = db
        .prepare('SELECT * FROM grade_categories WHERE class_id = ? ORDER BY sort_order, id')
        .all(v.id(rawClassId, 'classId')) as CategoryRow[]
      return rows.map(toCategory)
    },
    createCategory(input: CategoryInput): GradeCategory {
      const classId = v.id(input?.classId, 'classId')
      classExists(classId)
      const name = v.reqStr(input.name, 'Category name', 100)
      const weight = v.num(input.weight, 'Weight', 0)
      const next = (
        db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM grade_categories WHERE class_id = ?'
          )
          .get(classId) as {
          n: number
        }
      ).n
      const res = db
        .prepare(
          'INSERT INTO grade_categories (class_id, name, weight, sort_order) VALUES (?, ?, ?, ?)'
        )
        .run(classId, name, weight, next)
      emit('categories.changed', { classId })
      return mustCategory(Number(res.lastInsertRowid))
    },
    updateCategory(rawId: number, patch: Partial<Omit<CategoryInput, 'classId'>>): GradeCategory {
      const id = v.id(rawId)
      const cur = mustCategory(id)
      db.prepare('UPDATE grade_categories SET name = ?, weight = ? WHERE id = ?').run(
        patch.name !== undefined ? v.reqStr(patch.name, 'Category name', 100) : cur.name,
        patch.weight !== undefined ? v.num(patch.weight, 'Weight', 0) : cur.weight,
        id
      )
      emit('categories.changed', { classId: cur.classId })
      return mustCategory(id)
    },
    deleteCategory(rawId: number): void {
      const id = v.id(rawId)
      const cur = mustCategory(id)
      db.prepare('DELETE FROM grade_categories WHERE id = ?').run(id) // assignments become uncategorised
      emit('categories.changed', { classId: cur.classId })
      emit('assignments.changed', { classId: cur.classId })
    },
    assignments(rawClassId: number): Assignment[] {
      const rows = db
        .prepare('SELECT * FROM assignments WHERE class_id = ? ORDER BY sort_order, id')
        .all(v.id(rawClassId, 'classId')) as AssignmentRow[]
      return rows.map(toAssignment)
    },
    createAssignment(input: AssignmentInput): Assignment {
      const classId = v.id(input?.classId, 'classId')
      classExists(classId)
      const next = (
        db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM assignments WHERE class_id = ?'
          )
          .get(classId) as {
          n: number
        }
      ).n
      const res = db
        .prepare(
          `INSERT INTO assignments (class_id, category_id, title, points_possible, due_date, source_app, source_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          classId,
          categoryFor(input.categoryId, classId),
          v.reqStr(input.title, 'Title', 200),
          v.num(input.pointsPossible, 'Points possible', 0),
          v.dateOrNull(input.dueDate, 'Due date'),
          input.sourceApp == null ? null : v.reqStr(input.sourceApp, 'sourceApp', 50),
          input.sourceId == null ? null : v.reqStr(input.sourceId, 'sourceId', 100),
          next
        )
      emit('assignments.changed', { classId })
      return mustAssignment(Number(res.lastInsertRowid))
    },
    updateAssignment(rawId: number, patch: Partial<Omit<AssignmentInput, 'classId'>>): Assignment {
      const id = v.id(rawId)
      const cur = mustAssignment(id)
      db.prepare(
        'UPDATE assignments SET category_id = ?, title = ?, points_possible = ?, due_date = ? WHERE id = ?'
      ).run(
        patch.categoryId !== undefined
          ? categoryFor(patch.categoryId, cur.classId)
          : cur.categoryId,
        patch.title !== undefined ? v.reqStr(patch.title, 'Title', 200) : cur.title,
        patch.pointsPossible !== undefined
          ? v.num(patch.pointsPossible, 'Points possible', 0)
          : cur.pointsPossible,
        patch.dueDate !== undefined ? v.dateOrNull(patch.dueDate, 'Due date') : cur.dueDate,
        id
      )
      emit('assignments.changed', { classId: cur.classId })
      return mustAssignment(id)
    },
    deleteAssignment(rawId: number): void {
      const id = v.id(rawId)
      const cur = mustAssignment(id)
      db.prepare('DELETE FROM assignments WHERE id = ?').run(id) // scores cascade
      emit('assignments.changed', { classId: cur.classId })
      emit('scores.changed', { classId: cur.classId })
    },
    scores(rawClassId: number): Score[] {
      const rows = db
        .prepare(
          `SELECT s.* FROM scores s JOIN assignments a ON a.id = s.assignment_id
           WHERE a.class_id = ? ORDER BY s.id`
        )
        .all(v.id(rawClassId, 'classId')) as ScoreRow[]
      return rows.map(toScore)
    },
    setScore(input: ScoreInput): Score | null {
      const { classId, score } = writeScore(input)
      emit('scores.changed', { classId })
      return score
    },
    /** All-or-nothing: one bad row rolls back the whole batch. */
    setScores(inputs: ScoreInput[]): void {
      if (!Array.isArray(inputs)) throw new v.ValidationError('scores must be a list')
      const classIds = new Set<number>()
      db.transaction(() => {
        for (const input of inputs) classIds.add(writeScore(input).classId)
      })()
      for (const classId of classIds) emit('scores.changed', { classId })
    }
  }
}
