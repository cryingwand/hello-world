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
      quizzes: [],
      classes: [],
      assignments: []
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

/** A unit whose lessons carry dates, quizzes and attached files, to copy. */
function richUnit(env: TestEnv) {
  const { unit, a, b, c } = unitWithLessons(env)
  const quiz = env.repos.quizzes.create({ title: 'Quiz 1' })
  env.repos.units.update(unit.id, { summary: 'Big ideas' })
  env.repos.lessons.update(a.id, {
    date: '2026-10-01',
    objectives: 'Know X',
    plan: 'Warm-up\nDiscuss',
    homework: 'Read ch. 1',
    notes: 'Private'
  })
  env.repos.lessons.update(b.id, { date: '2026-10-08' })
  env.repos.lessons.linkQuiz(a.id, quiz.id)
  env.repos.fileLinks.add({ path: '/Users/t/Courses/a.pdf', recordType: 'lesson', recordId: a.id })
  env.repos.fileLinks.add({
    path: '/Users/t/Courses/unit.pdf',
    recordType: 'unit',
    recordId: unit.id
  })
  env.events.length = 0
  return { unit, a, b, c, quiz }
}

describe('copying a unit', () => {
  it('copies the unit and every lesson in order, with the same text', () => {
    const env = makeEnv()
    const { unit } = richUnit(env)
    const copy = env.repos.units.duplicate(unit.id)
    expect(copy.id).not.toBe(unit.id)
    expect(copy).toMatchObject({ title: 'Ethics (copy)', course: 'PHIL 101', summary: 'Big ideas' })
    expect(copy.lessons.map((l) => l.title)).toEqual(['Day 1', 'Day 2', 'Day 3'])
    expect(copy.lessons.map((l) => l.position)).toEqual([0, 1, 2])
    expect(copy.lessons[0]).toMatchObject({
      objectives: 'Know X',
      plan: 'Warm-up\nDiscuss',
      homework: 'Read ch. 1',
      notes: 'Private'
    })
    // The original is untouched.
    expect(env.repos.units.get(unit.id)!.lessons[0].date).toBe('2026-10-01')
    expect(env.repos.units.list()).toHaveLength(2)
  })

  it('clears lesson dates unless told otherwise', () => {
    const env = makeEnv()
    const { unit } = richUnit(env)
    expect(env.repos.units.duplicate(unit.id).lessons.map((l) => l.date)).toEqual([
      null,
      null,
      null
    ])
  })

  it('can keep the dates, or shift them all by a number of days', () => {
    const env = makeEnv()
    const { unit } = richUnit(env)
    const kept = env.repos.units.duplicate(unit.id, { dates: { mode: 'keep' } })
    expect(kept.lessons.map((l) => l.date)).toEqual(['2026-10-01', '2026-10-08', null])
    const shifted = env.repos.units.duplicate(unit.id, { dates: { mode: 'shift', days: 364 } })
    expect(shifted.lessons.map((l) => l.date)).toEqual(['2027-09-30', '2027-10-07', null])
    const earlier = env.repos.units.duplicate(unit.id, { dates: { mode: 'shift', days: -7 } })
    expect(earlier.lessons.map((l) => l.date)).toEqual(['2026-09-24', '2026-10-01', null])
  })

  it('links the same quizzes (they are shared, not copied) and attaches the same files', () => {
    const env = makeEnv()
    const { unit, a, quiz } = richUnit(env)
    const copy = env.repos.units.duplicate(unit.id)
    expect(copy.lessons[0].quizzes.map((q) => q.id)).toEqual([quiz.id])
    expect(env.repos.quizzes.list()).toHaveLength(1)
    expect(env.repos.fileLinks.list('lesson', copy.lessons[0].id).map((l) => l.path)).toEqual([
      '/Users/t/Courses/a.pdf'
    ])
    expect(env.repos.fileLinks.list('unit', copy.id).map((l) => l.path)).toEqual([
      '/Users/t/Courses/unit.pdf'
    ])
    // Removing a file from the copy leaves the original's attachment alone.
    env.repos.fileLinks.remove(env.repos.fileLinks.list('lesson', copy.lessons[0].id)[0].id)
    expect(env.repos.fileLinks.list('lesson', a.id)).toHaveLength(1)
  })

  it('deleting the copy leaves the original, its quizzes and its files alone', () => {
    const env = makeEnv()
    const { unit, quiz } = richUnit(env)
    const copy = env.repos.units.duplicate(unit.id)
    env.repos.units.delete(copy.id)
    const original = env.repos.units.get(unit.id)!
    expect(original.lessons).toHaveLength(3)
    expect(original.lessons[0].quizzes.map((q) => q.id)).toEqual([quiz.id])
    expect(env.repos.fileLinks.list('lesson', original.lessons[0].id)).toHaveLength(1)
    expect(env.repos.fileLinks.list('unit', unit.id)).toHaveLength(1)
  })

  it('takes a title of its own, and copes with an empty unit', () => {
    const env = makeEnv()
    const { unit } = richUnit(env)
    expect(env.repos.units.duplicate(unit.id, { title: ' Ethics, Spring ' }).title).toBe(
      'Ethics, Spring'
    )
    const empty = env.repos.units.create({ title: 'Empty' })
    expect(env.repos.units.duplicate(empty.id).lessons).toEqual([])
  })

  it('announces the change once, and the file links only when it made some', () => {
    const env = makeEnv()
    const { unit } = richUnit(env)
    env.repos.units.duplicate(unit.id)
    expect(env.events.map((e) => e.name)).toEqual(['planner.changed', 'fileLinks.changed'])
    env.events.length = 0
    const plain = env.repos.units.create({ title: 'Plain' })
    env.events.length = 0
    env.repos.units.duplicate(plain.id)
    expect(env.events.map((e) => e.name)).toEqual(['planner.changed'])
  })

  it('refuses bad input and writes nothing', () => {
    const env = makeEnv()
    const { unit } = richUnit(env)
    const before = env.repos.units.list().length
    expect(() => env.repos.units.duplicate(9999)).toThrow(/no longer exists/)
    expect(() => env.repos.units.duplicate(unit.id, { title: '  ' })).toThrow(/required/)
    expect(() => env.repos.units.duplicate(unit.id, { title: 'x'.repeat(201) })).toThrow(/too long/)
    expect(() =>
      env.repos.units.duplicate(unit.id, { dates: { mode: 'sideways' } as never })
    ).toThrow(/one of/)
    expect(() =>
      env.repos.units.duplicate(unit.id, { dates: { mode: 'shift', days: 1.5 } })
    ).toThrow(/whole number/)
    expect(() =>
      env.repos.units.duplicate(unit.id, { dates: { mode: 'shift', days: 99999 } })
    ).toThrow(/whole number/)
    expect(() =>
      env.repos.units.duplicate(unit.id, { dates: { mode: 'shift', days: 'x' as never } })
    ).toThrow(/must be a number/)
    expect(env.repos.units.list()).toHaveLength(before)
  })

  it('cuts a very long title to fit', () => {
    const env = makeEnv()
    const long = env.repos.units.create({ title: 'x'.repeat(200) })
    expect(env.repos.units.duplicate(long.id).title).toHaveLength(200)
  })
})

describe('copying a lesson', () => {
  it('puts the copy right after the original and renumbers the rest', () => {
    const env = makeEnv()
    const { unit, a } = richUnit(env)
    const copy = env.repos.lessons.duplicate(a.id)
    expect(copy).toMatchObject({ title: 'Day 1 (copy)', unitId: unit.id, position: 1 })
    expect(lessonTitles(env, unit.id)).toEqual(['Day 1', 'Day 1 (copy)', 'Day 2', 'Day 3'])
    expect(env.repos.units.get(unit.id)!.lessons.map((l) => l.position)).toEqual([0, 1, 2, 3])
  })

  it('copies the text, quizzes and files, and clears the date by default', () => {
    const env = makeEnv()
    const { a, quiz } = richUnit(env)
    const copy = env.repos.lessons.duplicate(a.id)
    expect(copy).toMatchObject({
      date: null,
      objectives: 'Know X',
      plan: 'Warm-up\nDiscuss',
      homework: 'Read ch. 1',
      notes: 'Private'
    })
    expect(copy.quizzes.map((q) => q.id)).toEqual([quiz.id])
    expect(env.repos.fileLinks.list('lesson', copy.id).map((l) => l.path)).toEqual([
      '/Users/t/Courses/a.pdf'
    ])
  })

  it('can keep or shift the date', () => {
    const env = makeEnv()
    const { a } = richUnit(env)
    expect(env.repos.lessons.duplicate(a.id, { dates: { mode: 'keep' } }).date).toBe('2026-10-01')
    expect(env.repos.lessons.duplicate(a.id, { dates: { mode: 'shift', days: 7 } }).date).toBe(
      '2026-10-08'
    )
  })

  it('copes with the last lesson, and refuses a missing one or a full unit', () => {
    const env = makeEnv()
    const { unit, c } = richUnit(env)
    expect(env.repos.lessons.duplicate(c.id).position).toBe(3)
    expect(() => env.repos.lessons.duplicate(9999)).toThrow(/no longer exists/)
    const big = env.repos.units.create({ title: 'Big' })
    env.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO lessons (unit_id, position, title) SELECT ?, i, 'L' FROM n`
      )
      .run(MAX_LESSONS - 1, big.id)
    const last = env.repos.units.get(big.id)!.lessons[0]
    expect(() => env.repos.lessons.duplicate(last.id)).toThrow(/too many lessons/)
    expect(env.repos.units.get(unit.id)!.lessons).toHaveLength(4)
  })
})

describe('moving a lesson to another unit', () => {
  it('appends it to the other unit and closes the gap in the first', () => {
    const env = makeEnv()
    const { unit, a } = richUnit(env)
    const other = env.repos.units.create({ title: 'Logic', course: 'PHIL 101' })
    env.repos.lessons.create({ unitId: other.id, title: 'L1' })
    const moved = env.repos.lessons.move(a.id, other.id)
    expect(moved).toMatchObject({ id: a.id, unitId: other.id, position: 1 })
    expect(lessonTitles(env, other.id)).toEqual(['L1', 'Day 1'])
    expect(lessonTitles(env, unit.id)).toEqual(['Day 2', 'Day 3'])
    expect(env.repos.units.get(unit.id)!.lessons.map((l) => l.position)).toEqual([0, 1])
  })

  it('takes its quizzes and attached files with it, and leaves the text alone', () => {
    const env = makeEnv()
    const { a, quiz } = richUnit(env)
    const other = env.repos.units.create({ title: 'Logic' })
    const moved = env.repos.lessons.move(a.id, other.id)
    expect(moved.quizzes.map((q) => q.id)).toEqual([quiz.id])
    expect(moved).toMatchObject({ date: '2026-10-01', objectives: 'Know X', notes: 'Private' })
    expect(env.repos.fileLinks.list('lesson', a.id)).toHaveLength(1)
  })

  it('moves into an empty unit', () => {
    const env = makeEnv()
    const { a } = richUnit(env)
    const empty = env.repos.units.create({ title: 'Empty' })
    expect(env.repos.lessons.move(a.id, empty.id).position).toBe(0)
  })

  it('refuses the same unit, a missing lesson or unit, and a full unit', () => {
    const env = makeEnv()
    const { unit, a } = richUnit(env)
    const other = env.repos.units.create({ title: 'Logic' })
    expect(() => env.repos.lessons.move(a.id, unit.id)).toThrow(/already in this unit/)
    expect(() => env.repos.lessons.move(9999, other.id)).toThrow(/no longer exists/)
    expect(() => env.repos.lessons.move(a.id, 9999)).toThrow(/no longer exists/)
    expect(() => env.repos.lessons.move(a.id, 'x' as never)).toThrow(/valid id/)
    env.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO lessons (unit_id, position, title) SELECT ?, i, 'L' FROM n`
      )
      .run(MAX_LESSONS - 1, other.id)
    expect(() => env.repos.lessons.move(a.id, other.id)).toThrow(/too many lessons/)
    expect(lessonTitles(env, unit.id)).toEqual(['Day 1', 'Day 2', 'Day 3'])
  })

  it('announces a planner change', () => {
    const env = makeEnv()
    const { a } = richUnit(env)
    const other = env.repos.units.create({ title: 'Logic' })
    env.events.length = 0
    env.repos.lessons.move(a.id, other.id)
    expect(env.events.map((e) => e.name)).toEqual(['planner.changed'])
  })
})

/** A current term with two classes, each with a couple of assignments, and a lesson to link. */
function classesAndLesson(env: TestEnv) {
  const term = env.repos.terms.create({ name: 'Fall 2026', isCurrent: true })
  const old = env.repos.terms.create({ name: 'Fall 2025' })
  const p3 = env.repos.classes.create({
    termId: term.id,
    course: 'PHIL 101',
    period: '3',
    gradingMode: 'points'
  })
  const p5 = env.repos.classes.create({
    termId: term.id,
    course: 'PHIL 101',
    period: '5',
    gradingMode: 'points'
  })
  const last = env.repos.classes.create({
    termId: old.id,
    course: 'PHIL 101',
    period: '2',
    gradingMode: 'points'
  })
  const hw3 = env.repos.grading.createAssignment({
    classId: p3.id,
    title: 'HW 1',
    pointsPossible: 10
  })
  const quiz3 = env.repos.grading.createAssignment({
    classId: p3.id,
    title: 'Quiz 1',
    pointsPossible: 20,
    dueDate: '2026-10-02'
  })
  const hw5 = env.repos.grading.createAssignment({
    classId: p5.id,
    title: 'HW 1',
    pointsPossible: 10
  })
  const unit = env.repos.units.create({ title: 'Ethics', course: 'PHIL 101' })
  const lesson = env.repos.lessons.create({ unitId: unit.id, title: 'Day 1' })
  env.events.length = 0
  return { term, p3, p5, last, hw3, quiz3, hw5, unit, lesson }
}

describe('linking a lesson to classes and Gradebook assignments', () => {
  it('starts with no links', () => {
    const env = makeEnv()
    const { lesson } = classesAndLesson(env)
    expect(lesson.classes).toEqual([])
    expect(lesson.assignments).toEqual([])
  })

  it('links a class and describes it', () => {
    const env = makeEnv()
    const { lesson, p3 } = classesAndLesson(env)
    const linked = env.repos.lessons.linkClass(lesson.id, p3.id)
    expect(linked.classes).toEqual([
      { id: p3.id, course: 'PHIL 101', section: '', period: '3', termName: 'Fall 2026' }
    ])
    expect(env.events.map((e) => e.name)).toEqual(['planner.changed'])
  })

  it('lists linked classes with the current term first, then by period', () => {
    const env = makeEnv()
    const { lesson, p3, p5, last } = classesAndLesson(env)
    for (const c of [last, p5, p3]) env.repos.lessons.linkClass(lesson.id, c.id)
    const classes = env.repos.units.get(lesson.unitId)!.lessons[0].classes
    expect(classes.map((c) => c.id)).toEqual([p3.id, p5.id, last.id])
  })

  it('linking a class twice is harmless', () => {
    const env = makeEnv()
    const { lesson, p3 } = classesAndLesson(env)
    env.repos.lessons.linkClass(lesson.id, p3.id)
    expect(env.repos.lessons.linkClass(lesson.id, p3.id).classes).toHaveLength(1)
  })

  it('links an assignment only once its class is linked', () => {
    const env = makeEnv()
    const { lesson, p3, hw3 } = classesAndLesson(env)
    expect(() => env.repos.lessons.linkAssignment(lesson.id, hw3.id)).toThrow(/Link the lesson to/)
    env.repos.lessons.linkClass(lesson.id, p3.id)
    const linked = env.repos.lessons.linkAssignment(lesson.id, hw3.id)
    expect(linked.assignments).toEqual([
      { id: hw3.id, classId: p3.id, title: 'HW 1', pointsPossible: 10, dueDate: null }
    ])
  })

  it('does not accept an assignment from a class that is not linked, even if another is', () => {
    const env = makeEnv()
    const { lesson, p3, hw5 } = classesAndLesson(env)
    env.repos.lessons.linkClass(lesson.id, p3.id)
    expect(() => env.repos.lessons.linkAssignment(lesson.id, hw5.id)).toThrow(/Link the lesson to/)
    expect(env.repos.units.get(lesson.unitId)!.lessons[0].assignments).toEqual([])
  })

  it('lists assignments in the Gradebook order, and links twice harmlessly', () => {
    const env = makeEnv()
    const { lesson, p3, hw3, quiz3 } = classesAndLesson(env)
    env.repos.lessons.linkClass(lesson.id, p3.id)
    env.repos.lessons.linkAssignment(lesson.id, quiz3.id)
    env.repos.lessons.linkAssignment(lesson.id, hw3.id)
    const again = env.repos.lessons.linkAssignment(lesson.id, hw3.id)
    expect(again.assignments.map((a) => a.title)).toEqual(['HW 1', 'Quiz 1'])
  })

  it('shows an assignment’s new title, points and due date straight away', () => {
    const env = makeEnv()
    const { lesson, p3, hw3 } = classesAndLesson(env)
    env.repos.lessons.linkClass(lesson.id, p3.id)
    env.repos.lessons.linkAssignment(lesson.id, hw3.id)
    env.repos.grading.updateAssignment(hw3.id, {
      title: 'Homework one',
      pointsPossible: 12,
      dueDate: '2026-10-05'
    })
    expect(env.repos.units.get(lesson.unitId)!.lessons[0].assignments[0]).toMatchObject({
      title: 'Homework one',
      pointsPossible: 12,
      dueDate: '2026-10-05'
    })
  })

  it('unlinking a class also unlinks its assignments, and only its own', () => {
    const env = makeEnv()
    const { lesson, p3, p5, hw3, hw5 } = classesAndLesson(env)
    for (const c of [p3, p5]) env.repos.lessons.linkClass(lesson.id, c.id)
    env.repos.lessons.linkAssignment(lesson.id, hw3.id)
    env.repos.lessons.linkAssignment(lesson.id, hw5.id)
    const after = env.repos.lessons.unlinkClass(lesson.id, p3.id)
    expect(after.classes.map((c) => c.id)).toEqual([p5.id])
    expect(after.assignments.map((a) => a.id)).toEqual([hw5.id])
    // Nothing in the Gradebook was touched.
    expect(env.repos.grading.assignments(p3.id)).toHaveLength(2)
  })

  it('unlinks one assignment and leaves the class linked', () => {
    const env = makeEnv()
    const { lesson, p3, hw3, quiz3 } = classesAndLesson(env)
    env.repos.lessons.linkClass(lesson.id, p3.id)
    env.repos.lessons.linkAssignment(lesson.id, hw3.id)
    env.repos.lessons.linkAssignment(lesson.id, quiz3.id)
    const after = env.repos.lessons.unlinkAssignment(lesson.id, hw3.id)
    expect(after.assignments.map((a) => a.id)).toEqual([quiz3.id])
    expect(after.classes).toHaveLength(1)
  })

  it('refuses ids that do not exist', () => {
    const env = makeEnv()
    const { lesson, p3 } = classesAndLesson(env)
    expect(() => env.repos.lessons.linkClass(9999, p3.id)).toThrow(/lesson no longer exists/)
    expect(() => env.repos.lessons.linkClass(lesson.id, 9999)).toThrow(/class no longer exists/)
    expect(() => env.repos.lessons.linkClass(lesson.id, 'x' as never)).toThrow(/valid id/)
    expect(() => env.repos.lessons.linkAssignment(lesson.id, 9999)).toThrow(/assignment no longer/)
    expect(() => env.repos.lessons.unlinkClass(9999, p3.id)).toThrow(/no longer exists/)
    expect(() => env.repos.lessons.unlinkAssignment(9999, 1)).toThrow(/no longer exists/)
  })

  describe('when something on either side is deleted', () => {
    const linked = (env: TestEnv) => {
      const ctx = classesAndLesson(env)
      env.repos.lessons.linkClass(ctx.lesson.id, ctx.p3.id)
      env.repos.lessons.linkAssignment(ctx.lesson.id, ctx.hw3.id)
      return ctx
    }
    const lessonNow = (env: TestEnv, unitId: number) => env.repos.units.get(unitId)!.lessons[0]

    it('deleting the class removes the class and its assignment links, nothing else', () => {
      const env = makeEnv()
      const { unit, p3, lesson } = linked(env)
      env.repos.lessons.update(lesson.id, { notes: 'keep me' })
      env.repos.classes.delete(p3.id)
      expect(lessonNow(env, unit.id)).toMatchObject({
        classes: [],
        assignments: [],
        notes: 'keep me'
      })
    })

    it('deleting an assignment removes only that link', () => {
      const env = makeEnv()
      const { unit, hw3 } = linked(env)
      env.repos.grading.deleteAssignment(hw3.id)
      const l = lessonNow(env, unit.id)
      expect(l.assignments).toEqual([])
      expect(l.classes).toHaveLength(1)
    })

    it('deleting the lesson or the unit never touches the Gradebook', () => {
      const env = makeEnv()
      const { unit, lesson, p3 } = linked(env)
      env.repos.lessons.delete(lesson.id)
      expect(env.repos.grading.assignments(p3.id)).toHaveLength(2)
      expect(env.repos.classes.get(p3.id)).not.toBeNull()
      expect(env.db.prepare('SELECT COUNT(*) AS n FROM lesson_classes').get()).toEqual({ n: 0 })
      expect(env.db.prepare('SELECT COUNT(*) AS n FROM lesson_assignments').get()).toEqual({ n: 0 })
      const other = env.repos.lessons.create({ unitId: unit.id, title: 'Again' })
      env.repos.lessons.linkClass(other.id, p3.id)
      env.repos.units.delete(unit.id)
      expect(env.db.prepare('SELECT COUNT(*) AS n FROM lesson_classes').get()).toEqual({ n: 0 })
      expect(env.repos.grading.assignments(p3.id)).toHaveLength(2)
    })
  })

  it('go with a lesson that is moved, but not into a copy', () => {
    const env = makeEnv()
    const { lesson, p3, hw3, unit } = classesAndLesson(env)
    env.repos.lessons.linkClass(lesson.id, p3.id)
    env.repos.lessons.linkAssignment(lesson.id, hw3.id)
    const other = env.repos.units.create({ title: 'Logic' })
    const moved = env.repos.lessons.move(lesson.id, other.id)
    expect(moved.classes.map((c) => c.id)).toEqual([p3.id])
    expect(moved.assignments.map((a) => a.id)).toEqual([hw3.id])
    // A copy is a plan for a different class or day: it starts with no Gradebook links.
    const copy = env.repos.lessons.duplicate(lesson.id)
    expect(copy.classes).toEqual([])
    expect(copy.assignments).toEqual([])
    const copiedUnit = env.repos.units.duplicate(other.id)
    expect(
      copiedUnit.lessons.every((l) => l.classes.length === 0 && l.assignments.length === 0)
    ).toBe(true)
    expect(unit.id).not.toBe(other.id)
  })

  it('appear on the upcoming list', () => {
    const env = makeEnv()
    const { lesson, p3 } = classesAndLesson(env)
    env.repos.lessons.update(lesson.id, { date: '2999-01-02' })
    env.repos.lessons.linkClass(lesson.id, p3.id)
    expect(env.repos.units.upcoming()[0].lesson.classes.map((c) => c.id)).toEqual([p3.id])
  })
})
