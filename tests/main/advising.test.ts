import { describe, expect, it } from 'vitest'
import { CHANGE_AUDIENCE } from '@shared/events'
import { localToday } from '@shared/advising'
import { makeEnv, type TestEnv } from './helpers'

function seed(env: TestEnv) {
  const ada = env.repos.students.create({
    firstName: 'Ada',
    lastName: 'Lovelace',
    tags: ['advisee']
  })
  const bo = env.repos.students.create({ firstName: 'Bo', lastName: 'Zed' })
  env.events.length = 0
  return { ada, bo }
}

describe('advisees', () => {
  it('lists only students tagged advisee, with what needs attention', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    expect(a.advisees().map((r) => r.student.id)).toEqual([ada.id])
    expect(a.advisees()[0]).toMatchObject({
      lastMeetingOn: null,
      activeGoals: 0,
      openActions: 0,
      nextDue: null
    })

    a.createMeeting({ studentId: ada.id, metOn: '2026-09-01' })
    a.createMeeting({ studentId: ada.id, metOn: '2026-10-01' })
    a.createGoal({ studentId: ada.id, title: 'Raise chem grade' })
    a.createGoal({ studentId: ada.id, title: 'Old', status: 'achieved' })
    a.createAction({ studentId: ada.id, title: 'later', dueDate: '2026-11-01' })
    a.createAction({ studentId: ada.id, title: 'sooner', dueDate: '2026-10-05' })
    a.createAction({ studentId: ada.id, title: 'finished', dueDate: '2026-09-01', done: true })
    expect(a.advisees()[0]).toMatchObject({
      lastMeetingOn: '2026-10-01',
      activeGoals: 1,
      openActions: 2,
      nextDue: '2026-10-05'
    })
  })

  it('drops a student from the list when the tag is removed, and keeps their records', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    env.repos.advising.createMeeting({ studentId: ada.id, metOn: '2026-10-01' })
    env.repos.students.update(ada.id, { tags: [] })
    expect(env.repos.advising.advisees()).toEqual([])
    expect(env.repos.advising.meetings(ada.id)).toHaveLength(1)
  })
})

describe('meetings', () => {
  it('creates, lists newest first, edits and deletes', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    const first = a.createMeeting({ studentId: ada.id, metOn: '2026-09-01', topic: ' Intro ' })
    const second = a.createMeeting({ studentId: ada.id, metOn: '2026-10-01' })
    expect(first.topic).toBe('Intro')
    expect(a.meetings(ada.id).map((m) => m.id)).toEqual([second.id, first.id])

    const edited = a.updateMeeting(first.id, { notes: 'talked', summary: 'done' })
    expect(edited).toMatchObject({ notes: 'talked', summary: 'done', topic: 'Intro' })
    a.deleteMeeting(second.id)
    expect(a.meetings(ada.id).map((m) => m.id)).toEqual([first.id])
  })

  it('validates the date and the student', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    expect(() => a.createMeeting({ studentId: ada.id, metOn: '' })).toThrow(/required/)
    expect(() => a.createMeeting({ studentId: ada.id, metOn: 'today' })).toThrow(/date/)
    expect(() => a.createMeeting({ studentId: 999, metOn: '2026-10-01' })).toThrow(/no longer/)
    const m = a.createMeeting({ studentId: ada.id, metOn: '2026-10-01' })
    expect(() => a.updateMeeting(m.id, { metOn: '' })).toThrow(/required/)
    expect(() => a.updateMeeting(m.id, { notes: 'x'.repeat(20001) })).toThrow(/too long/)
    expect(() => a.updateMeeting(999, {})).toThrow(/no longer exists/)
  })

  it('keeps the follow-ups of a deleted meeting, just unlinked', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    const m = a.createMeeting({ studentId: ada.id, metOn: '2026-10-01' })
    const act = a.createAction({ studentId: ada.id, title: 'Send form', meetingId: m.id })
    a.deleteMeeting(m.id)
    expect(a.actions(ada.id)).toEqual([{ ...act, meetingId: null }])
  })
})

describe('goals', () => {
  it('lists active goals first, then by target date', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    const done = a.createGoal({ studentId: ada.id, title: 'done', status: 'achieved' })
    const late = a.createGoal({ studentId: ada.id, title: 'late', targetDate: '2026-12-01' })
    const soon = a.createGoal({ studentId: ada.id, title: 'soon', targetDate: '2026-10-15' })
    const open = a.createGoal({ studentId: ada.id, title: 'undated' })
    expect(a.goals(ada.id).map((g) => g.id)).toEqual([soon.id, late.id, open.id, done.id])
  })

  it('validates and updates', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    expect(() => a.createGoal({ studentId: ada.id, title: ' ' })).toThrow(/required/)
    expect(() =>
      a.createGoal({ studentId: ada.id, title: 'x', status: 'nope' as 'active' })
    ).toThrow(/one of/)
    const g = a.createGoal({ studentId: ada.id, title: 'Read more' })
    expect(a.updateGoal(g.id, { status: 'dropped', targetDate: '2026-12-01' })).toMatchObject({
      title: 'Read more',
      status: 'dropped',
      targetDate: '2026-12-01'
    })
    expect(a.updateGoal(g.id, { targetDate: null }).targetDate).toBeNull()
  })
})

describe('follow-ups', () => {
  it('orders open ones by due date (undated last) and puts finished ones after', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    const none = a.createAction({ studentId: ada.id, title: 'undated' })
    const done = a.createAction({ studentId: ada.id, title: 'done', dueDate: '2026-01-01' })
    a.updateAction(done.id, { done: true })
    const late = a.createAction({ studentId: ada.id, title: 'late', dueDate: '2026-11-01' })
    const soon = a.createAction({ studentId: ada.id, title: 'soon', dueDate: '2026-10-01' })
    expect(a.actions(ada.id).map((x) => x.id)).toEqual([soon.id, late.id, none.id, done.id])
  })

  it('records the day it was finished, keeps it on a re-save, and clears it on reopen', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    const act = a.createAction({ studentId: ada.id, title: 'Call home' })
    expect(act.completedOn).toBeNull()
    expect(a.updateAction(act.id, { done: true }).completedOn).toBe(localToday())
    // Marking it done again must not move the date.
    env.db.prepare("UPDATE action_items SET completed_on = '2026-01-02' WHERE id = ?").run(act.id)
    expect(a.updateAction(act.id, { done: true, title: 'Call home today' }).completedOn).toBe(
      '2026-01-02'
    )
    expect(a.updateAction(act.id, { done: false }).completedOn).toBeNull()
  })

  it('uses the injected clock for the finished date', async () => {
    const { advisingRepo } = await import('../../src/main/repos/advising')
    const env = makeEnv()
    const { ada } = seed(env)
    const repo = advisingRepo(
      env.db,
      () => undefined,
      () => '2030-05-06'
    )
    const act = repo.createAction({ studentId: ada.id, title: 'x', done: true })
    expect(act.completedOn).toBe('2030-05-06')
  })

  it('lists every open follow-up for advisees only', () => {
    const env = makeEnv()
    const { ada, bo } = seed(env)
    const a = env.repos.advising
    const mine = a.createAction({ studentId: ada.id, title: 'open', dueDate: '2026-10-01' })
    a.createAction({ studentId: ada.id, title: 'done', done: true })
    a.createAction({ studentId: bo.id, title: 'not an advisee' })
    expect(a.openActions().map((x) => x.id)).toEqual([mine.id])
  })

  it('only links a meeting or goal that belongs to the same student', () => {
    const env = makeEnv()
    const { ada, bo } = seed(env)
    const a = env.repos.advising
    const theirs = a.createMeeting({ studentId: bo.id, metOn: '2026-10-01' })
    const theirGoal = a.createGoal({ studentId: bo.id, title: 'g' })
    expect(() => a.createAction({ studentId: ada.id, title: 'x', meetingId: theirs.id })).toThrow(
      /different student/
    )
    expect(() => a.createAction({ studentId: ada.id, title: 'x', goalId: theirGoal.id })).toThrow(
      /different student/
    )
    const act = a.createAction({ studentId: ada.id, title: 'x' })
    expect(() => a.updateAction(act.id, { meetingId: theirs.id })).toThrow(/different student/)
    expect(() => a.createAction({ studentId: ada.id, title: 'x', meetingId: 999 })).toThrow(
      /no longer exists/
    )
  })

  it('validates owner and title', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    expect(() => a.createAction({ studentId: ada.id, title: '' })).toThrow(/required/)
    expect(() => a.createAction({ studentId: ada.id, title: 'x', owner: 'dog' as 'me' })).toThrow(
      /one of/
    )
    expect(a.createAction({ studentId: ada.id, title: 'x', owner: 'me' }).owner).toBe('me')
  })
})

describe('external progress', () => {
  it('records grades earned elsewhere, newest first', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    const old = a.createProgress({
      studentId: ada.id,
      course: 'Algebra',
      grade: 'B+',
      recordedOn: '2026-01-10'
    })
    const recent = a.createProgress({
      studentId: ada.id,
      course: 'Geometry',
      term: 'Fall 2026',
      grade: '87',
      source: 'Online school',
      recordedOn: '2026-10-01'
    })
    expect(a.progress(ada.id).map((p) => p.id)).toEqual([recent.id, old.id])
    expect(a.updateProgress(old.id, { grade: 'A-' }).grade).toBe('A-')
    expect(() => a.createProgress({ studentId: ada.id, course: '' })).toThrow(/required/)
    a.deleteProgress(old.id)
    expect(a.progress(ada.id)).toHaveLength(1)
  })
})

describe('advising and the rest of the vault', () => {
  it('removes everything about a student when the student is deleted', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    a.createMeeting({ studentId: ada.id, metOn: '2026-10-01' })
    a.createGoal({ studentId: ada.id, title: 'g' })
    a.createAction({ studentId: ada.id, title: 'a' })
    a.createProgress({ studentId: ada.id, course: 'c' })
    env.events.length = 0
    env.repos.students.delete(ada.id)
    for (const table of ['advising_meetings', 'goals', 'action_items', 'external_progress']) {
      expect(env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 })
    }
    expect(env.events.map((e) => e.name)).toContain('advising.changed')
  })

  it('announces each write after it, to the vault only', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    const a = env.repos.advising
    const m = a.createMeeting({ studentId: ada.id, metOn: '2026-10-01' })
    a.updateMeeting(m.id, { notes: 'x' })
    a.deleteMeeting(m.id)
    expect(env.events.map((e) => e.name)).toEqual([
      'advising.changed',
      'advising.changed',
      'advising.changed'
    ])
    expect(CHANGE_AUDIENCE['advising.changed']).toEqual(['vault'])
  })

  it('emits nothing for a rejected write', () => {
    const env = makeEnv()
    const { ada } = seed(env)
    expect(() => env.repos.advising.createGoal({ studentId: ada.id, title: '' })).toThrow()
    expect(env.events).toEqual([])
  })
})
