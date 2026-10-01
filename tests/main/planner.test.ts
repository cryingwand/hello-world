import { describe, expect, it } from 'vitest'
import { CHANGE_AUDIENCE } from '@shared/events'
import { MAX_LESSONS } from '@shared/lesson'
import { plannerRepo } from '../../src/main/repos/planner'
import { makeEnv, type TestEnv } from './helpers'

/** A unit with three lessons: Day 1, Day 2, Day 3, in that order. */
function unitWithLessons(env: TestEnv, course = 'PHIL 101') {
  const unit = env.repos.units.create({ title: 'Ethics', course, summary: 'What is good?' })
  const [a, b, c] = ['Day 1', 'Day 2', 'Day 3'].map((title) =>
    env.repos.lessons.create({ unitId: unit.id, title })
  )
  env.events.length = 0
  return { unit, a, b, c }
}

const lessonTitles = (env: TestEnv, unitId: number): string[] =>
  env.repos.units.get(unitId)!.lessons.map((l) => l.title)

describe('units', () => {
  it('creates a unit with its details and no lessons', () => {
    const env = makeEnv()
    const unit = env.repos.units.create({ title: '  Ethics ', course: 'PHIL 101', summary: 'Why?' })
    expect(unit).toMatchObject({
      title: 'Ethics',
      course: 'PHIL 101',
      summary: 'Why?',
      lessons: []
    })
    expect(env.repos.units.get(unit.id)).toEqual(unit)
    expect(env.repos.units.get(9999)).toBeNull()
  })

  it('needs a title, and refuses text that is too long or not text', () => {
    const env = makeEnv()
    expect(() => env.repos.units.create({ title: '  ' })).toThrow(/Title is required/)
    expect(() => env.repos.units.create({ title: 'x'.repeat(201) })).toThrow(/too long/)
    expect(() => env.repos.units.create({ title: 'ok', course: 5 as unknown as string })).toThrow(
      /must be text/
    )
    expect(env.repos.units.list()).toEqual([])
  })

  it('updates only the fields given', () => {
    const env = makeEnv()
    const { unit } = unitWithLessons(env)
    const next = env.repos.units.update(unit.id, { title: 'Ethics II' })
    expect(next).toMatchObject({ title: 'Ethics II', course: 'PHIL 101', summary: 'What is good?' })
    expect(next.lessons).toHaveLength(3)
    expect(() => env.repos.units.update(unit.id, { title: '' })).toThrow(/required/)
    expect(() => env.repos.units.update(9999, { title: 'x' })).toThrow(/no longer exists/)
  })

  it('lists by course, then by when the unit starts, with undated units last', () => {
    const env = makeEnv()
    const make = (title: string, course: string, date: string | null) => {
      const u = env.repos.units.create({ title, course })
      env.repos.lessons.create({ unitId: u.id, title: 'L', date })
    }
    make('Late', 'Bio', '2026-11-01')
    make('Early', 'Bio', '2026-09-01')
    make('Undated', 'Bio', null)
    make('Other course', 'art', '2026-01-01')
    env.repos.units.create({ title: 'Empty', course: 'Bio' })
    const list = env.repos.units.list()
    expect(list.map((u) => u.title)).toEqual(['Other course', 'Early', 'Late', 'Undated', 'Empty'])
    expect(list.find((u) => u.title === 'Early')).toMatchObject({
      lessonCount: 1,
      firstDate: '2026-09-01',
      lastDate: '2026-09-01'
    })
    expect(list.find((u) => u.title === 'Empty')).toMatchObject({
      lessonCount: 0,
      firstDate: null,
      lastDate: null
    })
  })

  it('reports the span of a unit from its lesson dates', () => {
    const env = makeEnv()
    const { unit, a, b, c } = unitWithLessons(env)
    env.repos.lessons.update(a.id, { date: '2026-10-05' })
    env.repos.lessons.update(c.id, { date: '2026-10-01' })
    void b
    expect(env.repos.units.list()[0]).toMatchObject({
      id: unit.id,
      lessonCount: 3,
      firstDate: '2026-10-01',
      lastDate: '2026-10-05'
    })
  })

  it('deletes the unit with its lessons, and the file links of both, and nothing else', () => {
    const env = makeEnv()
    const { unit, a } = unitWithLessons(env)
    const other = unitWithLessons(env, 'BIO')
    const links = env.repos.fileLinks
    links.add({ path: '/m/unit.pdf', recordType: 'unit', recordId: unit.id })
    links.add({ path: '/m/day1.pdf', recordType: 'lesson', recordId: a.id })
    links.add({ path: '/m/other.pdf', recordType: 'unit', recordId: other.unit.id })
    links.add({ path: '/m/otherday.pdf', recordType: 'lesson', recordId: other.a.id })
    env.events.length = 0

    env.repos.units.delete(unit.id)

    expect(env.repos.units.get(unit.id)).toBeNull()
    expect(
      env.db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE unit_id = ?').get(unit.id)
    ).toEqual({ n: 0 })
    expect(links.list('unit', unit.id)).toEqual([])
    expect(links.list('lesson', a.id)).toEqual([])
    expect(links.list('unit', other.unit.id)).toHaveLength(1)
    expect(links.list('lesson', other.a.id)).toHaveLength(1)
    expect(env.repos.units.get(other.unit.id)!.lessons).toHaveLength(3)
    expect(env.events.map((e) => e.name).sort()).toEqual(['fileLinks.changed', 'planner.changed'])
  })

  it('leaves the quizzes a deleted unit used', () => {
    const env = makeEnv()
    const { unit, a } = unitWithLessons(env)
    const quiz = env.repos.quizzes.create({ title: 'Quiz 1' })
    env.repos.lessons.linkQuiz(a.id, quiz.id)
    env.repos.units.delete(unit.id)
    expect(env.repos.quizzes.get(quiz.id)).not.toBeNull()
    expect(env.db.prepare('SELECT COUNT(*) AS n FROM lesson_quizzes').get()).toEqual({ n: 0 })
  })

  it('does not announce a file change when nothing was attached', () => {
    const env = makeEnv()
    const { unit } = unitWithLessons(env)
    env.repos.units.delete(unit.id)
    expect(env.events.map((e) => e.name)).toEqual(['planner.changed'])
  })
})

describe('lessons', () => {
  it('adds lessons at the end, in order, with every field', () => {
    const env = makeEnv()
    const unit = env.repos.units.create({ title: 'U' })
    const one = env.repos.lessons.create({
      unitId: unit.id,
      title: ' Day 1 ',
      date: '2026-10-02',
      objectives: 'Define ethics',
      plan: 'Warm-up\nLecture',
      homework: 'Read ch. 1',
      notes: 'Remember the projector'
    })
    const two = env.repos.lessons.create({ unitId: unit.id, title: 'Day 2' })
    expect(one).toEqual({
      id: one.id,
      unitId: unit.id,
      position: 0,
      title: 'Day 1',
      date: '2026-10-02',
      objectives: 'Define ethics',
      plan: 'Warm-up\nLecture',
      homework: 'Read ch. 1',
      notes: 'Remember the projector',
      quizzes: []
    })
    expect(two).toMatchObject({ position: 1, date: null, plan: '' })
    expect(lessonTitles(env, unit.id)).toEqual(['Day 1', 'Day 2'])
  })

  it('validates what it is given', () => {
    const env = makeEnv()
    const unit = env.repos.units.create({ title: 'U' })
    const make = (extra: object) =>
      env.repos.lessons.create({ unitId: unit.id, title: 'L', ...extra })
    expect(() => make({ title: '' })).toThrow(/Title is required/)
    expect(() => make({ date: '10/2/2026' })).toThrow(/Date must be a date/)
    expect(() => make({ date: '2026-13-45' })).toThrow(/Date must be a date/)
    expect(() => make({ plan: 'x'.repeat(20001) })).toThrow(/too long/)
    expect(() => make({ unitId: 9999 })).toThrow(/no longer exists/)
    expect(() => make({ unitId: 'x' })).toThrow(/valid id/)
    expect(env.repos.units.get(unit.id)!.lessons).toEqual([])
  })

  it('refuses a unit with more lessons than the limit', () => {
    const env = makeEnv()
    const unit = env.repos.units.create({ title: 'U' })
    const insert = env.db.prepare('INSERT INTO lessons (unit_id, position, title) VALUES (?, ?, ?)')
    for (let i = 0; i < MAX_LESSONS; i++) insert.run(unit.id, i, `L${i}`)
    expect(() => env.repos.lessons.create({ unitId: unit.id, title: 'One more' })).toThrow(
      /too many lessons/
    )
  })

  it('updates only the fields given, and can clear a date', () => {
    const env = makeEnv()
    const { a } = unitWithLessons(env)
    env.repos.lessons.update(a.id, { date: '2026-10-02', plan: 'Do it', homework: 'HW' })
    const next = env.repos.lessons.update(a.id, { title: 'Renamed', date: null })
    expect(next).toMatchObject({ title: 'Renamed', date: null, plan: 'Do it', homework: 'HW' })
    expect(() => env.repos.lessons.update(a.id, { date: 'soon' })).toThrow(/Date must be a date/)
    expect(() => env.repos.lessons.update(9999, { title: 'x' })).toThrow(/no longer exists/)
  })

  it('deletes a lesson, closes the gap and clears its file links', () => {
    const env = makeEnv()
    const { unit, a, b, c } = unitWithLessons(env)
    env.repos.fileLinks.add({ path: '/m/b.pdf', recordType: 'lesson', recordId: b.id })
    env.repos.fileLinks.add({ path: '/m/a.pdf', recordType: 'lesson', recordId: a.id })
    env.events.length = 0
    env.repos.lessons.delete(b.id)
    const left = env.repos.units.get(unit.id)!.lessons
    expect(left.map((l) => [l.title, l.position])).toEqual([
      ['Day 1', 0],
      ['Day 3', 1]
    ])
    expect(env.repos.fileLinks.list('lesson', b.id)).toEqual([])
    expect(env.repos.fileLinks.list('lesson', a.id)).toHaveLength(1)
    expect(env.events.map((e) => e.name).sort()).toEqual(['fileLinks.changed', 'planner.changed'])
    void c
    expect(() => env.repos.lessons.delete(b.id)).toThrow(/no longer exists/)
  })

  it('reorders, and insists the new order lists every lesson once', () => {
    const env = makeEnv()
    const { unit, a, b, c } = unitWithLessons(env)
    const next = env.repos.units.reorder(unit.id, [c.id, a.id, b.id])
    expect(next.lessons.map((l) => [l.title, l.position])).toEqual([
      ['Day 3', 0],
      ['Day 1', 1],
      ['Day 2', 2]
    ])
    expect(() => env.repos.units.reorder(unit.id, [a.id, b.id])).toThrow(/each lesson/)
    expect(() => env.repos.units.reorder(unit.id, [a.id, a.id, b.id])).toThrow(/each lesson/)
    expect(() => env.repos.units.reorder(unit.id, [a.id, b.id, 9999])).toThrow(/each lesson/)
    expect(() => env.repos.units.reorder(unit.id, 'x' as unknown as number[])).toThrow(/list/)
    expect(lessonTitles(env, unit.id)).toEqual(['Day 3', 'Day 1', 'Day 2'])
  })

  it('cannot reorder using a lesson from another unit', () => {
    const env = makeEnv()
    const { unit, a, b, c } = unitWithLessons(env)
    const other = unitWithLessons(env, 'BIO')
    expect(() => env.repos.units.reorder(unit.id, [a.id, b.id, other.a.id])).toThrow(/each lesson/)
    void c
    expect(lessonTitles(env, other.unit.id)).toEqual(['Day 1', 'Day 2', 'Day 3'])
  })
})

describe('linked quizzes', () => {
  it('links a quiz to a lesson, once, and lists it in date order', () => {
    const env = makeEnv()
    const { a } = unitWithLessons(env)
    const late = env.repos.quizzes.create({ title: 'Late', kind: 'exam', date: '2026-12-01' })
    const early = env.repos.quizzes.create({ title: 'Early', date: '2026-10-01' })
    env.repos.lessons.linkQuiz(a.id, late.id)
    env.repos.lessons.linkQuiz(a.id, early.id)
    const again = env.repos.lessons.linkQuiz(a.id, early.id)
    expect(again.quizzes).toEqual([
      { id: early.id, kind: 'quiz', title: 'Early', date: '2026-10-01' },
      { id: late.id, kind: 'exam', title: 'Late', date: '2026-12-01' }
    ])
  })

  it('lets more than one lesson use the same quiz', () => {
    const env = makeEnv()
    const { unit, a, b } = unitWithLessons(env)
    const quiz = env.repos.quizzes.create({ title: 'Review' })
    env.repos.lessons.linkQuiz(a.id, quiz.id)
    env.repos.lessons.linkQuiz(b.id, quiz.id)
    const lessons = env.repos.units.get(unit.id)!.lessons
    expect(lessons.map((l) => l.quizzes.length)).toEqual([1, 1, 0])
  })

  it('unlinks without touching the quiz', () => {
    const env = makeEnv()
    const { a } = unitWithLessons(env)
    const quiz = env.repos.quizzes.create({ title: 'Quiz' })
    env.repos.lessons.linkQuiz(a.id, quiz.id)
    expect(env.repos.lessons.unlinkQuiz(a.id, quiz.id).quizzes).toEqual([])
    expect(env.repos.lessons.unlinkQuiz(a.id, quiz.id).quizzes).toEqual([])
    expect(env.repos.quizzes.get(quiz.id)).not.toBeNull()
  })

  it('refuses a quiz or lesson that is gone', () => {
    const env = makeEnv()
    const { a } = unitWithLessons(env)
    expect(() => env.repos.lessons.linkQuiz(a.id, 9999)).toThrow(/quiz no longer exists/)
    expect(() => env.repos.lessons.linkQuiz(9999, 1)).toThrow(/lesson no longer exists/)
  })

  it('drops the link, and tells the planner, when the quiz is deleted', () => {
    const env = makeEnv()
    const { unit, a } = unitWithLessons(env)
    const quiz = env.repos.quizzes.create({ title: 'Quiz' })
    env.repos.lessons.linkQuiz(a.id, quiz.id)
    env.events.length = 0
    env.repos.quizzes.delete(quiz.id)
    expect(env.repos.units.get(unit.id)!.lessons[0].quizzes).toEqual([])
    expect(env.events.map((e) => e.name)).toContain('planner.changed')
  })

  it('does not bother the planner when an unlinked quiz is deleted', () => {
    const env = makeEnv()
    const quiz = env.repos.quizzes.create({ title: 'Quiz' })
    env.events.length = 0
    env.repos.quizzes.delete(quiz.id)
    expect(env.events.map((e) => e.name)).not.toContain('planner.changed')
  })

  it('shows a renamed quiz under its new name', () => {
    const env = makeEnv()
    const { unit, a } = unitWithLessons(env)
    const quiz = env.repos.quizzes.create({ title: 'Old' })
    env.repos.lessons.linkQuiz(a.id, quiz.id)
    env.repos.quizzes.update(quiz.id, { title: 'New' })
    expect(env.repos.units.get(unit.id)!.lessons[0].quizzes[0].title).toBe('New')
  })
})

describe('coming up', () => {
  function withToday(env: TestEnv, today: string) {
    return plannerRepo(
      env.db,
      () => undefined,
      () => today
    ).units
  }

  it('lists lessons dated today or later, soonest first, with where they belong', () => {
    const env = makeEnv()
    const bio = env.repos.units.create({ title: 'Cells', course: 'BIO' })
    const phil = env.repos.units.create({ title: 'Ethics', course: 'PHIL' })
    const add = (unitId: number, title: string, date: string | null) =>
      env.repos.lessons.create({ unitId, title, date })
    add(bio.id, 'Past', '2026-10-04')
    add(bio.id, 'Undated', null)
    add(bio.id, 'Later', '2026-10-09')
    add(phil.id, 'Today', '2026-10-05')
    add(phil.id, 'Same day, other course sorts by course', '2026-10-09')
    const up = withToday(env, '2026-10-05').upcoming()
    expect(up.map((u) => u.lesson.title)).toEqual([
      'Today',
      'Later',
      'Same day, other course sorts by course'
    ])
    expect(up[0]).toMatchObject({ unitTitle: 'Ethics', course: 'PHIL' })
  })

  it('includes each lesson’s quizzes', () => {
    const env = makeEnv()
    const { a } = unitWithLessons(env)
    const quiz = env.repos.quizzes.create({ title: 'Quiz' })
    env.repos.lessons.update(a.id, { date: '2026-10-06' })
    env.repos.lessons.linkQuiz(a.id, quiz.id)
    const up = withToday(env, '2026-10-05').upcoming()
    expect(up[0].lesson.quizzes.map((q) => q.title)).toEqual(['Quiz'])
  })

  it('is empty when nothing is dated, or everything is over', () => {
    const env = makeEnv()
    unitWithLessons(env)
    expect(withToday(env, '2026-10-05').upcoming()).toEqual([])
    const { a } = unitWithLessons(env, 'BIO')
    env.repos.lessons.update(a.id, { date: '2020-01-01' })
    expect(withToday(env, '2026-10-05').upcoming()).toEqual([])
  })

  it('stops at thirty', () => {
    const env = makeEnv()
    const unit = env.repos.units.create({ title: 'U' })
    for (let i = 0; i < 35; i++) {
      env.repos.lessons.create({
        unitId: unit.id,
        title: `L${i}`,
        date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`
      })
    }
    expect(withToday(env, '2026-10-05').upcoming()).toHaveLength(30)
  })
})

describe('file links for units and lessons', () => {
  it('attaches files to a unit or a lesson, and only to ones that exist', () => {
    const env = makeEnv()
    const { unit, a } = unitWithLessons(env)
    const links = env.repos.fileLinks
    expect(links.add({ path: '/m/unit.pdf', recordType: 'unit', recordId: unit.id })).toMatchObject(
      {
        recordType: 'unit'
      }
    )
    links.add({ path: '/m/day.pdf', recordType: 'lesson', recordId: a.id })
    expect(links.list('unit', unit.id).map((l) => l.path)).toEqual(['/m/unit.pdf'])
    expect(links.list('lesson', a.id).map((l) => l.path)).toEqual(['/m/day.pdf'])
    expect(() => links.add({ path: '/m/x.pdf', recordType: 'lesson', recordId: 9999 })).toThrow(
      /lesson no longer exists/
    )
    expect(() =>
      links.add({ path: '/m/x.pdf', recordType: 'quiz' as 'unit', recordId: 1 })
    ).toThrow(/Record type must be one of/)
  })
})

describe('events', () => {
  it('announces planner changes to the vault only', () => {
    expect(CHANGE_AUDIENCE['planner.changed']).toEqual(['vault'])
    const env = makeEnv()
    const unit = env.repos.units.create({ title: 'U' })
    const lesson = env.repos.lessons.create({ unitId: unit.id, title: 'L' })
    env.repos.lessons.update(lesson.id, { title: 'M' })
    env.repos.units.update(unit.id, { title: 'V' })
    expect(new Set(env.events.map((e) => e.name))).toEqual(new Set(['planner.changed']))
  })

  it('stays quiet when a call is refused', () => {
    const env = makeEnv()
    env.events.length = 0
    expect(() => env.repos.units.create({ title: '' })).toThrow()
    expect(() => env.repos.lessons.create({ unitId: 9999, title: 'x' })).toThrow()
    expect(env.events).toEqual([])
  })
})
