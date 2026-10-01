import { localToday } from '@shared/advising'
import type { ActionInput, GoalInput, MeetingInput, ProgressInput } from '@shared/api'
import type {
  ActionItem,
  ActionOwner,
  AdviseeSummary,
  AdvisingGoal,
  AdvisingMeeting,
  ExternalProgress,
  GoalStatus
} from '@shared/models'
import * as v from '../validate'
import { toStudent, type StudentRow } from './students'
import type { Db, Emit } from './types'

interface MeetingRow {
  id: number
  student_id: number
  met_on: string
  topic: string
  notes: string
  summary: string
}
interface GoalRow {
  id: number
  student_id: number
  title: string
  details: string
  target_date: string | null
  status: GoalStatus
}
interface ActionRow {
  id: number
  student_id: number
  meeting_id: number | null
  goal_id: number | null
  title: string
  due_date: string | null
  owner: ActionOwner
  completed_on: string | null
}
interface ProgressRow {
  id: number
  student_id: number
  course: string
  term: string
  grade: string
  source: string
  recorded_on: string | null
}
interface AdviseeRow extends StudentRow {
  last_meeting_on: string | null
  active_goals: number
  open_actions: number
  next_due: string | null
}

const toMeeting = (r: MeetingRow): AdvisingMeeting => ({
  id: r.id,
  studentId: r.student_id,
  metOn: r.met_on,
  topic: r.topic,
  notes: r.notes,
  summary: r.summary
})
const toGoal = (r: GoalRow): AdvisingGoal => ({
  id: r.id,
  studentId: r.student_id,
  title: r.title,
  details: r.details,
  targetDate: r.target_date,
  status: r.status
})
const toAction = (r: ActionRow): ActionItem => ({
  id: r.id,
  studentId: r.student_id,
  meetingId: r.meeting_id,
  goalId: r.goal_id,
  title: r.title,
  dueDate: r.due_date,
  owner: r.owner,
  completedOn: r.completed_on
})
const toProgress = (r: ProgressRow): ExternalProgress => ({
  id: r.id,
  studentId: r.student_id,
  course: r.course,
  term: r.term,
  grade: r.grade,
  source: r.source,
  recordedOn: r.recorded_on
})

const GOAL_STATUSES = ['active', 'achieved', 'dropped'] as const
const OWNERS = ['student', 'me'] as const

/** A required date: `dateOrNull` plus a refusal of blank. */
function reqDate(value: unknown, field: string): string {
  const d = v.dateOrNull(value, field)
  if (!d) throw new v.ValidationError(`${field} is required`)
  return d
}

export function advisingRepo(db: Db, emit: Emit, today: () => string = localToday) {
  const studentExists = (id: number): void => {
    if (!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) {
      throw new v.ValidationError('That student no longer exists')
    }
  }

  const getMeeting = (id: number): AdvisingMeeting | null => {
    const r = db.prepare('SELECT * FROM advising_meetings WHERE id = ?').get(id) as
      MeetingRow | undefined
    return r ? toMeeting(r) : null
  }
  const mustMeeting = (id: number): AdvisingMeeting => {
    const m = getMeeting(id)
    if (!m) throw new v.ValidationError('That meeting no longer exists')
    return m
  }
  const getGoal = (id: number): AdvisingGoal | null => {
    const r = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as GoalRow | undefined
    return r ? toGoal(r) : null
  }
  const mustGoal = (id: number): AdvisingGoal => {
    const g = getGoal(id)
    if (!g) throw new v.ValidationError('That goal no longer exists')
    return g
  }
  const getAction = (id: number): ActionItem | null => {
    const r = db.prepare('SELECT * FROM action_items WHERE id = ?').get(id) as ActionRow | undefined
    return r ? toAction(r) : null
  }
  const mustAction = (id: number): ActionItem => {
    const a = getAction(id)
    if (!a) throw new v.ValidationError('That follow-up no longer exists')
    return a
  }
  const getProgress = (id: number): ExternalProgress | null => {
    const r = db.prepare('SELECT * FROM external_progress WHERE id = ?').get(id) as
      ProgressRow | undefined
    return r ? toProgress(r) : null
  }
  const mustProgress = (id: number): ExternalProgress => {
    const p = getProgress(id)
    if (!p) throw new v.ValidationError('That entry no longer exists')
    return p
  }

  /** A follow-up may point at a meeting or goal, but only the same student's. */
  const checkLinks = (studentId: number, meetingId: number | null, goalId: number | null): void => {
    if (meetingId !== null && mustMeeting(meetingId).studentId !== studentId) {
      throw new v.ValidationError('That meeting belongs to a different student')
    }
    if (goalId !== null && mustGoal(goalId).studentId !== studentId) {
      throw new v.ValidationError('That goal belongs to a different student')
    }
  }
  const optId = (value: unknown, field: string): number | null =>
    value == null ? null : v.id(value, field)

  return {
    advisees(): AdviseeSummary[] {
      const rows = db
        .prepare(
          `SELECT s.*,
             (SELECT MAX(met_on) FROM advising_meetings m WHERE m.student_id = s.id) AS last_meeting_on,
             (SELECT COUNT(*) FROM goals g WHERE g.student_id = s.id AND g.status = 'active') AS active_goals,
             (SELECT COUNT(*) FROM action_items a
                WHERE a.student_id = s.id AND a.completed_on IS NULL) AS open_actions,
             (SELECT MIN(due_date) FROM action_items a
                WHERE a.student_id = s.id AND a.completed_on IS NULL) AS next_due
           FROM students s
           WHERE EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = 'advisee')
           ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE, s.id`
        )
        .all() as AdviseeRow[]
      return rows.map((r) => ({
        student: toStudent(r),
        lastMeetingOn: r.last_meeting_on,
        activeGoals: r.active_goals,
        openActions: r.open_actions,
        nextDue: r.next_due
      }))
    },

    /** One meeting, for the main process (Word export). Not part of the window API. */
    meeting(rawId: number): AdvisingMeeting | null {
      return getMeeting(v.id(rawId))
    },
    meetings(rawStudentId: number): AdvisingMeeting[] {
      const rows = db
        .prepare(
          'SELECT * FROM advising_meetings WHERE student_id = ? ORDER BY met_on DESC, id DESC'
        )
        .all(v.id(rawStudentId, 'studentId')) as MeetingRow[]
      return rows.map(toMeeting)
    },
    createMeeting(input: MeetingInput): AdvisingMeeting {
      const studentId = v.id(input?.studentId, 'studentId')
      studentExists(studentId)
      const res = db
        .prepare(
          'INSERT INTO advising_meetings (student_id, met_on, topic, notes, summary) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          studentId,
          reqDate(input.metOn, 'Meeting date'),
          v.optStr(input.topic, 'Topic', 200),
          v.optStr(input.notes, 'Notes', 20000),
          v.optStr(input.summary, 'Summary', 20000)
        )
      emit('advising.changed')
      return mustMeeting(Number(res.lastInsertRowid))
    },
    updateMeeting(rawId: number, patch: Partial<MeetingInput>): AdvisingMeeting {
      const id = v.id(rawId)
      const cur = mustMeeting(id)
      db.prepare(
        'UPDATE advising_meetings SET met_on = ?, topic = ?, notes = ?, summary = ? WHERE id = ?'
      ).run(
        patch.metOn !== undefined ? reqDate(patch.metOn, 'Meeting date') : cur.metOn,
        patch.topic !== undefined ? v.optStr(patch.topic, 'Topic', 200) : cur.topic,
        patch.notes !== undefined ? v.optStr(patch.notes, 'Notes', 20000) : cur.notes,
        patch.summary !== undefined ? v.optStr(patch.summary, 'Summary', 20000) : cur.summary,
        id
      )
      emit('advising.changed')
      return mustMeeting(id)
    },
    deleteMeeting(rawId: number): void {
      // Follow-ups that came out of it stay (the foreign key clears their link).
      db.prepare('DELETE FROM advising_meetings WHERE id = ?').run(v.id(rawId))
      emit('advising.changed')
    },

    goals(rawStudentId: number): AdvisingGoal[] {
      const rows = db
        .prepare(
          `SELECT * FROM goals WHERE student_id = ?
           ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(target_date, '9999-99-99'), id`
        )
        .all(v.id(rawStudentId, 'studentId')) as GoalRow[]
      return rows.map(toGoal)
    },
    createGoal(input: GoalInput): AdvisingGoal {
      const studentId = v.id(input?.studentId, 'studentId')
      studentExists(studentId)
      const res = db
        .prepare(
          'INSERT INTO goals (student_id, title, details, target_date, status) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          studentId,
          v.reqStr(input.title, 'Goal', 300),
          v.optStr(input.details, 'Details', 5000),
          v.dateOrNull(input.targetDate, 'Target date'),
          input.status === undefined ? 'active' : v.oneOf(input.status, GOAL_STATUSES, 'Status')
        )
      emit('advising.changed')
      return mustGoal(Number(res.lastInsertRowid))
    },
    updateGoal(rawId: number, patch: Partial<GoalInput>): AdvisingGoal {
      const id = v.id(rawId)
      const cur = mustGoal(id)
      db.prepare(
        'UPDATE goals SET title = ?, details = ?, target_date = ?, status = ? WHERE id = ?'
      ).run(
        patch.title !== undefined ? v.reqStr(patch.title, 'Goal', 300) : cur.title,
        patch.details !== undefined ? v.optStr(patch.details, 'Details', 5000) : cur.details,
        patch.targetDate !== undefined
          ? v.dateOrNull(patch.targetDate, 'Target date')
          : cur.targetDate,
        patch.status !== undefined ? v.oneOf(patch.status, GOAL_STATUSES, 'Status') : cur.status,
        id
      )
      emit('advising.changed')
      return mustGoal(id)
    },
    deleteGoal(rawId: number): void {
      db.prepare('DELETE FROM goals WHERE id = ?').run(v.id(rawId))
      emit('advising.changed')
    },

    actions(rawStudentId: number): ActionItem[] {
      const rows = db
        .prepare(
          `SELECT * FROM action_items WHERE student_id = ?
           ORDER BY completed_on IS NOT NULL, COALESCE(due_date, '9999-99-99'), id`
        )
        .all(v.id(rawStudentId, 'studentId')) as ActionRow[]
      return rows.map(toAction)
    },
    openActions(): ActionItem[] {
      const rows = db
        .prepare(
          `SELECT a.* FROM action_items a JOIN students s ON s.id = a.student_id
           WHERE a.completed_on IS NULL
             AND EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = 'advisee')
           ORDER BY COALESCE(a.due_date, '9999-99-99'), a.id`
        )
        .all() as ActionRow[]
      return rows.map(toAction)
    },
    createAction(input: ActionInput): ActionItem {
      const studentId = v.id(input?.studentId, 'studentId')
      studentExists(studentId)
      const meetingId = optId(input.meetingId, 'meetingId')
      const goalId = optId(input.goalId, 'goalId')
      checkLinks(studentId, meetingId, goalId)
      const res = db
        .prepare(
          `INSERT INTO action_items (student_id, meeting_id, goal_id, title, due_date, owner, completed_on)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          studentId,
          meetingId,
          goalId,
          v.reqStr(input.title, 'Follow-up', 300),
          v.dateOrNull(input.dueDate, 'Due date'),
          input.owner === undefined ? 'student' : v.oneOf(input.owner, OWNERS, 'Owner'),
          input.done ? today() : null
        )
      emit('advising.changed')
      return mustAction(Number(res.lastInsertRowid))
    },
    updateAction(rawId: number, patch: Partial<ActionInput>): ActionItem {
      const id = v.id(rawId)
      const cur = mustAction(id)
      const meetingId =
        patch.meetingId !== undefined ? optId(patch.meetingId, 'meetingId') : cur.meetingId
      const goalId = patch.goalId !== undefined ? optId(patch.goalId, 'goalId') : cur.goalId
      checkLinks(cur.studentId, meetingId, goalId)
      // Re-saving a finished item keeps the day it was finished; only a change of state moves it.
      let completedOn = cur.completedOn
      if (patch.done === true && !cur.completedOn) completedOn = today()
      else if (patch.done === false) completedOn = null
      db.prepare(
        `UPDATE action_items SET meeting_id = ?, goal_id = ?, title = ?, due_date = ?, owner = ?,
           completed_on = ? WHERE id = ?`
      ).run(
        meetingId,
        goalId,
        patch.title !== undefined ? v.reqStr(patch.title, 'Follow-up', 300) : cur.title,
        patch.dueDate !== undefined ? v.dateOrNull(patch.dueDate, 'Due date') : cur.dueDate,
        patch.owner !== undefined ? v.oneOf(patch.owner, OWNERS, 'Owner') : cur.owner,
        completedOn,
        id
      )
      emit('advising.changed')
      return mustAction(id)
    },
    deleteAction(rawId: number): void {
      db.prepare('DELETE FROM action_items WHERE id = ?').run(v.id(rawId))
      emit('advising.changed')
    },

    progress(rawStudentId: number): ExternalProgress[] {
      const rows = db
        .prepare(
          `SELECT * FROM external_progress WHERE student_id = ?
           ORDER BY COALESCE(recorded_on, '') DESC, id DESC`
        )
        .all(v.id(rawStudentId, 'studentId')) as ProgressRow[]
      return rows.map(toProgress)
    },
    createProgress(input: ProgressInput): ExternalProgress {
      const studentId = v.id(input?.studentId, 'studentId')
      studentExists(studentId)
      const res = db
        .prepare(
          `INSERT INTO external_progress (student_id, course, term, grade, source, recorded_on)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          studentId,
          v.reqStr(input.course, 'Course', 200),
          v.optStr(input.term, 'Term', 100),
          v.optStr(input.grade, 'Grade', 50),
          v.optStr(input.source, 'Source', 200),
          v.dateOrNull(input.recordedOn, 'Date')
        )
      emit('advising.changed')
      return mustProgress(Number(res.lastInsertRowid))
    },
    updateProgress(rawId: number, patch: Partial<ProgressInput>): ExternalProgress {
      const id = v.id(rawId)
      const cur = mustProgress(id)
      db.prepare(
        `UPDATE external_progress SET course = ?, term = ?, grade = ?, source = ?, recorded_on = ?
         WHERE id = ?`
      ).run(
        patch.course !== undefined ? v.reqStr(patch.course, 'Course', 200) : cur.course,
        patch.term !== undefined ? v.optStr(patch.term, 'Term', 100) : cur.term,
        patch.grade !== undefined ? v.optStr(patch.grade, 'Grade', 50) : cur.grade,
        patch.source !== undefined ? v.optStr(patch.source, 'Source', 200) : cur.source,
        patch.recordedOn !== undefined ? v.dateOrNull(patch.recordedOn, 'Date') : cur.recordedOn,
        id
      )
      emit('advising.changed')
      return mustProgress(id)
    },
    deleteProgress(rawId: number): void {
      db.prepare('DELETE FROM external_progress WHERE id = ?').run(v.id(rawId))
      emit('advising.changed')
    }
  }
}
