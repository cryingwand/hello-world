import type { StudentInput, StudentQuery } from '@shared/api'
import type { Student } from '@shared/models'
import * as v from '../validate'
import type { Db, Emit } from './types'

interface Row {
  id: number
  first_name: string
  last_name: string
  preferred_name: string
  email: string
  notes: string
  tags: string
}

const toStudent = (r: Row): Student => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  preferredName: r.preferred_name,
  email: r.email,
  notes: r.notes,
  tags: JSON.parse(r.tags) as string[]
})

function cleanNames(first: unknown, last: unknown): { first: string; last: string } {
  const f = v.optStr(first, 'First name', 100)
  const l = v.optStr(last, 'Last name', 100)
  if (!f && !l) throw new v.ValidationError('A student needs a first or last name')
  return { first: f, last: l }
}

export function studentsRepo(db: Db, emit: Emit) {
  const get = (id: number): Student | null => {
    const r = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as Row | undefined
    return r ? toStudent(r) : null
  }
  const must = (id: number): Student => {
    const s = get(id)
    if (!s) throw new v.ValidationError('That student no longer exists')
    return s
  }

  return {
    get,
    list(query: StudentQuery = {}): Student[] {
      const where: string[] = []
      const args: unknown[] = []
      let from = 'students s'
      if (query.classId !== undefined) {
        from = 'students s JOIN enrollments e ON e.student_id = s.id'
        where.push('e.class_id = ?')
        args.push(v.id(query.classId, 'classId'))
      }
      if (query.search?.trim()) {
        const p = v.likePattern(query.search.trim())
        where.push(
          `(s.first_name LIKE ? ESCAPE '\\' OR s.last_name LIKE ? ESCAPE '\\' OR s.preferred_name LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\')`
        )
        args.push(p, p, p, p)
      }
      if (query.tag?.trim()) {
        where.push('EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = ?)')
        args.push(query.tag.trim().toLowerCase())
      }
      const sql = `SELECT s.* FROM ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE, s.id`
      return (db.prepare(sql).all(...args) as Row[]).map(toStudent)
    },
    create(input: StudentInput): Student {
      const { first, last } = cleanNames(input?.firstName, input?.lastName)
      const res = db
        .prepare(
          `INSERT INTO students (first_name, last_name, preferred_name, email, notes, tags)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          first,
          last,
          v.optStr(input.preferredName, 'Preferred name', 100),
          v.optStr(input.email, 'Email', 200),
          v.optStr(input.notes, 'Notes', 5000),
          JSON.stringify(v.tags(input.tags))
        )
      emit('students.changed')
      return must(Number(res.lastInsertRowid))
    },
    update(rawId: number, patch: Partial<StudentInput>): Student {
      const id = v.id(rawId)
      const cur = must(id)
      const { first, last } = cleanNames(
        patch.firstName ?? cur.firstName,
        patch.lastName ?? cur.lastName
      )
      db.prepare(
        `UPDATE students SET first_name = ?, last_name = ?, preferred_name = ?, email = ?, notes = ?, tags = ?
         WHERE id = ?`
      ).run(
        first,
        last,
        patch.preferredName !== undefined
          ? v.optStr(patch.preferredName, 'Preferred name', 100)
          : cur.preferredName,
        patch.email !== undefined ? v.optStr(patch.email, 'Email', 200) : cur.email,
        patch.notes !== undefined ? v.optStr(patch.notes, 'Notes', 5000) : cur.notes,
        JSON.stringify(patch.tags !== undefined ? v.tags(patch.tags) : cur.tags),
        id
      )
      emit('students.changed')
      return must(id)
    },
    delete(rawId: number): void {
      const id = v.id(rawId)
      db.transaction(() => {
        db.prepare("DELETE FROM file_links WHERE record_type = 'student' AND record_id = ?").run(id)
        db.prepare('DELETE FROM students WHERE id = ?').run(id) // enrollments and scores cascade
      })()
      emit('students.changed')
      emit('enrollments.changed')
      emit('scores.changed')
    }
  }
}
