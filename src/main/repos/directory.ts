import { studentDisplayName } from '@shared/advising'
import type { DirectoryClass, DirectoryStudent } from '@shared/models'
import * as v from '../validate'
import type { Db, Emit } from './types'

/** What the Vault hands over to be copied: names and which class they are in, in the order to keep. */
export interface RosterSnapshot {
  classes: {
    id: number
    course: string
    section: string
    period: string
    termName: string
    currentTerm: boolean
    students: { id: number; firstName: string; lastName: string; preferredName: string }[]
  }[]
}

interface ClassRow {
  class_id: number
  course: string
  section: string
  period: string
  term_name: string
  current_term: number
  student_count: number
}
interface MemberRow {
  student_id: number
  first_name: string
  last_name: string
  preferred_name: string
}

/**
 * The names-only roster copy in the everyday database (see `ROSTER_COPY_SQL`). The window API can
 * only read it. The one writer is `replace`, called from the main process when the Vault changes, so
 * the copy is always a plain mirror of the roster and never a second place to edit it.
 */
export function directoryRepo(db: Db, emit: Emit) {
  const classRows = (): ClassRow[] =>
    db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM roster_members m WHERE m.class_id = c.class_id) AS student_count
         FROM roster_classes c ORDER BY c.position`
      )
      .all() as ClassRow[]
  const memberRows = (classId: number): MemberRow[] =>
    db
      .prepare('SELECT * FROM roster_members WHERE class_id = ? ORDER BY position')
      .all(classId) as MemberRow[]

  /** The copy as a snapshot, for comparing with a new one. */
  const current = (): RosterSnapshot => ({
    classes: classRows().map((c) => ({
      id: c.class_id,
      course: c.course,
      section: c.section,
      period: c.period,
      termName: c.term_name,
      currentTerm: c.current_term === 1,
      students: memberRows(c.class_id).map((m) => ({
        id: m.student_id,
        firstName: m.first_name,
        lastName: m.last_name,
        preferredName: m.preferred_name
      }))
    }))
  })

  return {
    classes(): DirectoryClass[] {
      return classRows().map((c) => ({
        id: c.class_id,
        course: c.course,
        section: c.section,
        period: c.period,
        termName: c.term_name,
        currentTerm: c.current_term === 1,
        studentCount: c.student_count
      }))
    },

    students(rawClassId: number): DirectoryStudent[] {
      const classId = v.id(rawClassId, 'classId')
      return memberRows(classId).map((m) => ({
        id: m.student_id,
        name: studentDisplayName({
          firstName: m.first_name,
          lastName: m.last_name,
          preferredName: m.preferred_name
        })
      }))
    },

    /**
     * Makes the copy match the snapshot exactly, all or nothing, and announces it only if something
     * changed. Returns whether it did. Not part of the window API.
     */
    replace(snapshot: RosterSnapshot): boolean {
      if (JSON.stringify(current()) === JSON.stringify(snapshot)) return false
      db.transaction(() => {
        db.prepare('DELETE FROM roster_members').run()
        db.prepare('DELETE FROM roster_classes').run()
        const addClass = db.prepare(
          `INSERT INTO roster_classes (class_id, course, section, period, term_name, current_term, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        const addMember = db.prepare(
          `INSERT INTO roster_members (class_id, student_id, first_name, last_name, preferred_name, position)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        snapshot.classes.forEach((c, ci) => {
          addClass.run(c.id, c.course, c.section, c.period, c.termName, c.currentTerm ? 1 : 0, ci)
          c.students.forEach((s, si) =>
            addMember.run(c.id, s.id, s.firstName, s.lastName, s.preferredName, si)
          )
        })
      })()
      emit('directory.changed')
      return true
    }
  }
}

export type DirectoryRepo = ReturnType<typeof directoryRepo>
