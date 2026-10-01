import type { ClassInput } from '@shared/api'
import type { ClassRecord, ClassSummary, Student } from '@shared/models'
import * as v from '../validate'
import type { Db, Emit } from './types'

interface Row {
  id: number
  term_id: number
  course: string
  section: string
  period: string
  grading_mode: 'weighted' | 'points'
}
interface SummaryRow extends Row {
  term_name: string
  student_count: number
}

const toClass = (r: Row): ClassRecord => ({
  id: r.id,
  termId: r.term_id,
  course: r.course,
  section: r.section,
  period: r.period,
  gradingMode: r.grading_mode
})
const toSummary = (r: SummaryRow): ClassSummary => ({
  ...toClass(r),
  termName: r.term_name,
  studentCount: r.student_count
})

const SUMMARY_SQL = `
  SELECT c.*, t.name AS term_name,
         (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id) AS student_count
  FROM classes c JOIN terms t ON t.id = c.term_id`

export function classesRepo(db: Db, emit: Emit) {
  const get = (id: number): ClassRecord | null => {
    const r = db.prepare('SELECT * FROM classes WHERE id = ?').get(id) as Row | undefined
    return r ? toClass(r) : null
  }
  const must = (id: number): ClassRecord => {
    const c = get(id)
    if (!c) throw new v.ValidationError('That class no longer exists')
    return c
  }
  const termExists = (id: number): void => {
    if (!db.prepare('SELECT 1 FROM terms WHERE id = ?').get(id)) {
      throw new v.ValidationError('That term no longer exists')
    }
  }

  return {
    get,
    list(termId?: number): ClassSummary[] {
      const rows =
        termId === undefined
          ? (db
              .prepare(
                `${SUMMARY_SQL} ORDER BY t.is_current DESC, t.start_date DESC, c.course COLLATE NOCASE, c.period, c.section`
              )
              .all() as SummaryRow[])
          : (db
              .prepare(
                `${SUMMARY_SQL} WHERE c.term_id = ? ORDER BY c.course COLLATE NOCASE, c.period, c.section`
              )
              .all(v.id(termId, 'termId')) as SummaryRow[])
      return rows.map(toSummary)
    },
    create(input: ClassInput): ClassRecord {
      const termId = v.id(input?.termId, 'Term')
      termExists(termId)
      const res = db
        .prepare(
          'INSERT INTO classes (term_id, course, section, period, grading_mode) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          termId,
          v.reqStr(input.course, 'Course'),
          v.optStr(input.section, 'Section', 50),
          v.optStr(input.period, 'Period', 50),
          v.oneOf(input.gradingMode, ['weighted', 'points'] as const, 'Grading mode')
        )
      emit('classes.changed')
      return must(Number(res.lastInsertRowid))
    },
    update(rawId: number, patch: Partial<ClassInput>): ClassRecord {
      const id = v.id(rawId)
      const cur = must(id)
      const termId = patch.termId !== undefined ? v.id(patch.termId, 'Term') : cur.termId
      if (termId !== cur.termId) termExists(termId)
      db.prepare(
        'UPDATE classes SET term_id = ?, course = ?, section = ?, period = ?, grading_mode = ? WHERE id = ?'
      ).run(
        termId,
        patch.course !== undefined ? v.reqStr(patch.course, 'Course') : cur.course,
        patch.section !== undefined ? v.optStr(patch.section, 'Section', 50) : cur.section,
        patch.period !== undefined ? v.optStr(patch.period, 'Period', 50) : cur.period,
        patch.gradingMode !== undefined
          ? v.oneOf(patch.gradingMode, ['weighted', 'points'] as const, 'Grading mode')
          : cur.gradingMode,
        id
      )
      emit('classes.changed', { classId: id })
      return must(id)
    },
    delete(rawId: number): void {
      const id = v.id(rawId)
      db.transaction(() => {
        db.prepare("DELETE FROM file_links WHERE record_type = 'class' AND record_id = ?").run(id)
        db.prepare('DELETE FROM classes WHERE id = ?').run(id) // enrollments, categories, assignments, scores cascade
      })()
      emit('classes.changed', { classId: id })
      emit('enrollments.changed', { classId: id })
      emit('categories.changed', { classId: id })
      emit('assignments.changed', { classId: id })
      emit('scores.changed', { classId: id })
    },
    roster(rawClassId: number): Student[] {
      const classId = v.id(rawClassId, 'classId')
      const rows = db
        .prepare(
          `SELECT s.* FROM students s JOIN enrollments e ON e.student_id = s.id
           WHERE e.class_id = ?
           ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE, s.id`
        )
        .all(classId) as {
        id: number
        first_name: string
        last_name: string
        preferred_name: string
        email: string
        notes: string
        tags: string
      }[]
      return rows.map((r) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        preferredName: r.preferred_name,
        email: r.email,
        notes: r.notes,
        tags: JSON.parse(r.tags) as string[]
      }))
    },
    enroll(rawClassId: number, rawStudentId: number): void {
      const classId = v.id(rawClassId, 'classId')
      const studentId = v.id(rawStudentId, 'studentId')
      must(classId)
      if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(studentId)) {
        throw new v.ValidationError('That student no longer exists')
      }
      db.prepare('INSERT OR IGNORE INTO enrollments (class_id, student_id) VALUES (?, ?)').run(
        classId,
        studentId
      )
      emit('enrollments.changed', { classId })
    },
    unenroll(rawClassId: number, rawStudentId: number): void {
      const classId = v.id(rawClassId, 'classId')
      const studentId = v.id(rawStudentId, 'studentId')
      db.transaction(() => {
        db.prepare('DELETE FROM enrollments WHERE class_id = ? AND student_id = ?').run(
          classId,
          studentId
        )
        // Their scores in this class go with the enrollment so they cannot resurface if re-enrolled.
        db.prepare(
          `DELETE FROM scores WHERE student_id = ? AND assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)`
        ).run(studentId, classId)
      })()
      emit('enrollments.changed', { classId })
      emit('scores.changed', { classId })
    },
    forStudent(rawStudentId: number): ClassSummary[] {
      const studentId = v.id(rawStudentId, 'studentId')
      const rows = db
        .prepare(
          `${SUMMARY_SQL} WHERE c.id IN (SELECT class_id FROM enrollments WHERE student_id = ?)
           ORDER BY t.is_current DESC, t.start_date DESC, c.course COLLATE NOCASE`
        )
        .all(studentId) as SummaryRow[]
      return rows.map(toSummary)
    }
  }
}
