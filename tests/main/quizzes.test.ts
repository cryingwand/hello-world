import { describe, expect, it } from 'vitest'
import type { QuestionInput } from '@shared/api'
import { CHANGE_AUDIENCE } from '@shared/events'
import { QUIZ_SOURCE_APP } from '@shared/quiz'
import { makeEnv, seedClass, type TestEnv } from './helpers'

const mc = (prompt: string, extra: Partial<QuestionInput> = {}): QuestionInput => ({
  kind: 'multiple-choice',
  prompt,
  choices: ['one', 'two', 'three'],
  correctChoice: 1,
  ...extra
})

function bank(env: TestEnv) {
  const q = env.repos.questions
  const a = q.create(mc('Which is first?', { tags: ['Unit 1'] }))
  const b = q.create({ kind: 'true-false', prompt: 'Water is wet.', correctChoice: 0, points: 2 })
  const c = q.create({ kind: 'short-answer', prompt: 'Define ethics.', answer: 'The study of…' })
  const d = q.create({ kind: 'essay', prompt: 'Discuss.', points: 10, tags: ['unit 2'] })
  env.events.length = 0
  return { a, b, c, d }
}

describe('questions', () => {
  it('creates each kind with the shape that kind allows', () => {
    const env = makeEnv()
    const { a, b, c } = bank(env)
    expect(a).toMatchObject({
      kind: 'multiple-choice',
      choices: ['one', 'two', 'three'],
      correctChoice: 1,
      points: 1,
      tags: ['unit 1'],
      quizCount: 0
    })
    expect(b).toMatchObject({ choices: ['True', 'False'], correctChoice: 0, points: 2 })
    expect(c).toMatchObject({ choices: [], correctChoice: null, answer: 'The study of…' })
  })

  it('drops choices that a kind does not use', () => {
    const env = makeEnv()
    const q = env.repos.questions.create({
      kind: 'short-answer',
      prompt: 'Name one.',
      choices: ['x', 'y'],
      correctChoice: 1
    })
    expect(q).toMatchObject({ choices: [], correctChoice: null })
    const tf = env.repos.questions.create({
      kind: 'true-false',
      prompt: 'Yes?',
      choices: ['maybe', 'perhaps'],
      correctChoice: 1
    })
    expect(tf.choices).toEqual(['True', 'False'])
  })

  it('refuses choices that do not make sense', () => {
    const q = makeEnv().repos.questions
    expect(() => q.create(mc('x', { choices: ['only'] }))).toThrow(/between 2 and 6/)
    expect(() => q.create(mc('x', { choices: ['1', '2', '3', '4', '5', '6', '7'] }))).toThrow(
      /between 2 and 6/
    )
    expect(() => q.create(mc('x', { choices: ['a', '  '] }))).toThrow(/some text/)
    expect(() => q.create(mc('x', { correctChoice: null }))).toThrow(/Mark which choice/)
    expect(() => q.create(mc('x', { correctChoice: 3 }))).toThrow(/not one of the choices/)
    expect(() => q.create(mc('x', { correctChoice: -1 }))).toThrow(/not one of the choices/)
    expect(() => q.create({ kind: 'true-false', prompt: 'x', correctChoice: 2 })).toThrow(
      /not one of the choices/
    )
    expect(() => q.create(mc('   '))).toThrow(/required/)
    expect(() => q.create(mc('x', { points: -1 }))).toThrow(/at least 0/)
    expect(() => q.create({ kind: 'riddle' as never, prompt: 'x' })).toThrow(/one of/)
  })

  it('revalidates the whole question when the kind changes', () => {
    const env = makeEnv()
    const { a } = bank(env)
    const q = env.repos.questions
    // Becoming short answer clears the choices and the right answer.
    expect(q.update(a.id, { kind: 'short-answer', answer: 'one' })).toMatchObject({
      kind: 'short-answer',
      choices: [],
      correctChoice: null,
      answer: 'one'
    })
    // Becoming multiple choice again needs choices and a right answer.
    expect(() => q.update(a.id, { kind: 'multiple-choice' })).toThrow(/between 2 and 6/)
    expect(
      q.update(a.id, { kind: 'multiple-choice', choices: ['p', 'q'], correctChoice: 0 })
    ).toMatchObject({ kind: 'multiple-choice', choices: ['p', 'q'], correctChoice: 0 })
  })

  it('only changes what a patch names', () => {
    const env = makeEnv()
    const { a } = bank(env)
    const after = env.repos.questions.update(a.id, { points: 3 })
    expect(after).toMatchObject({ prompt: a.prompt, choices: a.choices, tags: a.tags, points: 3 })
  })

  it('lists newest first and filters by text, kind and tag, treating wildcards literally', () => {
    const env = makeEnv()
    const { a, b, c, d } = bank(env)
    const q = env.repos.questions
    expect(q.list().map((x) => x.id)).toEqual([d.id, c.id, b.id, a.id])
    expect(q.list({ search: 'ethics' }).map((x) => x.id)).toEqual([c.id])
    // Choices are searched too.
    expect(q.list({ search: 'three' }).map((x) => x.id)).toEqual([a.id])
    expect(q.list({ kind: 'true-false' }).map((x) => x.id)).toEqual([b.id])
    expect(q.list({ tag: 'UNIT 1' }).map((x) => x.id)).toEqual([a.id])
    expect(q.list({ kind: 'essay', tag: 'unit 2' }).map((x) => x.id)).toEqual([d.id])
    expect(q.list({ search: '100%' })).toEqual([])
    q.create(mc('Is it 100% sure?'))
    expect(q.list({ search: '100%' })).toHaveLength(1)
    expect(q.list({ search: '_' })).toEqual([])
  })

  it('emits changes for the vault only', () => {
    const env = makeEnv()
    env.repos.questions.create(mc('x'))
    expect(env.events.map((e) => e.name)).toEqual(['questions.changed', 'quizzes.changed'])
    expect(CHANGE_AUDIENCE['questions.changed']).toEqual(['vault'])
    expect(CHANGE_AUDIENCE['quizzes.changed']).toEqual(['vault'])
  })
})

describe('quizzes', () => {
  it('creates, lists and edits a quiz', () => {
    const env = makeEnv()
    const z = env.repos.quizzes
    const quiz = z.create({ title: ' Quiz 3 ', course: 'PHIL 101', date: '2026-10-02' })
    expect(quiz).toMatchObject({
      kind: 'quiz',
      title: 'Quiz 3',
      course: 'PHIL 101',
      date: '2026-10-02',
      entries: [],
      totalPoints: 0
    })
    z.create({ title: 'Final', kind: 'exam', date: '2026-12-10' })
    z.create({ title: 'Undated' })
    expect(z.list().map((x) => x.title)).toEqual(['Final', 'Quiz 3', 'Undated'])

    const edited = z.update(quiz.id, { title: 'Quiz 4', kind: 'exam', date: null })
    expect(edited).toMatchObject({ title: 'Quiz 4', kind: 'exam', date: null, course: 'PHIL 101' })
    expect(() => z.create({ title: '' })).toThrow(/required/)
    expect(() => z.create({ title: 'x', date: 'soon' })).toThrow(/date/)
    expect(() => z.create({ title: 'x', kind: 'test' as never })).toThrow(/one of/)
    expect(z.get(9999)).toBeNull()
    expect(() => z.update(9999, { title: 'x' })).toThrow(/no longer exists/)
  })

  it('adds questions in order, skips repeats, and counts points', () => {
    const env = makeEnv()
    const { a, b, c } = bank(env)
    const z = env.repos.quizzes
    const quiz = z.create({ title: 'Q' })
    env.events.length = 0

    const withTwo = z.addQuestions(quiz.id, [b.id, a.id])
    expect(withTwo.entries.map((e) => e.questionId)).toEqual([b.id, a.id])
    expect(withTwo.entries.map((e) => e.position)).toEqual([0, 1])
    expect(withTwo.totalPoints).toBe(3)
    expect(env.events.map((e) => e.name).sort()).toEqual(['questions.changed', 'quizzes.changed'])

    const more = z.addQuestions(quiz.id, [a.id, c.id])
    expect(more.entries.map((e) => e.questionId)).toEqual([b.id, a.id, c.id])
    expect(env.repos.questions.get(a.id)?.quizCount).toBe(1)
    expect(() => z.addQuestions(quiz.id, [9999])).toThrow(/no longer exists/)
    expect(() => z.addQuestions(quiz.id, 'x' as never)).toThrow(/must be a list/)
    // A bad id anywhere in the list adds nothing.
    const d2 = env.repos.questions.create(mc('late'))
    expect(() => z.addQuestions(quiz.id, [d2.id, 9999])).toThrow()
    expect(z.get(quiz.id)?.entries).toHaveLength(3)
  })

  it('overrides points for one quiz only, and goes back with null', () => {
    const env = makeEnv()
    const { a } = bank(env)
    const z = env.repos.quizzes
    const one = z.create({ title: 'One' })
    const two = z.create({ title: 'Two' })
    z.addQuestions(one.id, [a.id])
    z.addQuestions(two.id, [a.id])

    const bumped = z.setPoints(one.id, a.id, 5)
    expect(bumped.entries[0]).toMatchObject({ pointsOverride: 5, points: 5 })
    expect(bumped.totalPoints).toBe(5)
    expect(z.get(two.id)?.totalPoints).toBe(1)
    expect(env.repos.questions.get(a.id)?.points).toBe(1)

    expect(z.setPoints(one.id, a.id, null).entries[0]).toMatchObject({
      pointsOverride: null,
      points: 1
    })
    expect(() => z.setPoints(one.id, a.id, -1)).toThrow(/at least 0/)
    expect(() => z.setPoints(one.id, 9999, 1)).toThrow(/not in this quiz/)
  })

  it('follows a question’s own points until a quiz overrides them', () => {
    const env = makeEnv()
    const { a } = bank(env)
    const z = env.repos.quizzes
    const quiz = z.create({ title: 'Q' })
    z.addQuestions(quiz.id, [a.id])
    env.repos.questions.update(a.id, { points: 4 })
    expect(z.get(quiz.id)?.totalPoints).toBe(4)
    expect(z.list()[0]).toMatchObject({ questionCount: 1, totalPoints: 4 })
  })

  it('adds points without floating point dust', () => {
    const env = makeEnv()
    const z = env.repos.quizzes
    const q1 = env.repos.questions.create(mc('a', { points: 0.1 }))
    const q2 = env.repos.questions.create(mc('b', { points: 0.2 }))
    const quiz = z.create({ title: 'Q' })
    z.addQuestions(quiz.id, [q1.id, q2.id])
    expect(z.get(quiz.id)?.totalPoints).toBe(0.3)
    expect(z.list()[0].totalPoints).toBe(0.3)
  })

  it('removes a question and closes the gap', () => {
    const env = makeEnv()
    const { a, b, c } = bank(env)
    const z = env.repos.quizzes
    const quiz = z.create({ title: 'Q' })
    z.addQuestions(quiz.id, [a.id, b.id, c.id])
    const after = z.removeQuestion(quiz.id, b.id)
    expect(after.entries.map((e) => [e.questionId, e.position])).toEqual([
      [a.id, 0],
      [c.id, 1]
    ])
    expect(env.repos.questions.get(b.id)?.quizCount).toBe(0)
    // Removing something that is not there is harmless.
    expect(z.removeQuestion(quiz.id, b.id).entries).toHaveLength(2)
  })

  it('reorders, and insists on exactly the questions already in the quiz', () => {
    const env = makeEnv()
    const { a, b, c, d } = bank(env)
    const z = env.repos.quizzes
    const quiz = z.create({ title: 'Q' })
    z.addQuestions(quiz.id, [a.id, b.id, c.id])
    expect(z.reorder(quiz.id, [c.id, a.id, b.id]).entries.map((e) => e.questionId)).toEqual([
      c.id,
      a.id,
      b.id
    ])
    expect(() => z.reorder(quiz.id, [a.id, b.id])).toThrow(/each question in the quiz once/)
    expect(() => z.reorder(quiz.id, [a.id, a.id, b.id])).toThrow(/each question in the quiz once/)
    expect(() => z.reorder(quiz.id, [a.id, b.id, d.id])).toThrow(/each question in the quiz once/)
    expect(z.get(quiz.id)?.entries.map((e) => e.questionId)).toEqual([c.id, a.id, b.id])
  })

  it('refuses to delete a question that is in a quiz, until it is taken out', () => {
    const env = makeEnv()
    const { a } = bank(env)
    const z = env.repos.quizzes
    const quiz = z.create({ title: 'Q' })
    z.addQuestions(quiz.id, [a.id])
    expect(() => env.repos.questions.delete(a.id)).toThrow(/in 1 quiz\. Take it out/)
    const other = z.create({ title: 'R' })
    z.addQuestions(other.id, [a.id])
    expect(() => env.repos.questions.delete(a.id)).toThrow(/in 2 quizzes/)
    z.removeQuestion(quiz.id, a.id)
    z.removeQuestion(other.id, a.id)
    env.repos.questions.delete(a.id)
    expect(env.repos.questions.get(a.id)).toBeNull()
  })

  it('keeps the database itself from losing a question that is in a quiz', () => {
    const env = makeEnv()
    const { a } = bank(env)
    const quiz = env.repos.quizzes.create({ title: 'Q' })
    env.repos.quizzes.addQuestions(quiz.id, [a.id])
    expect(() => env.db.prepare('DELETE FROM questions WHERE id = ?').run(a.id)).toThrow(
      /FOREIGN KEY/
    )
  })

  it('deleting a quiz frees its questions', () => {
    const env = makeEnv()
    const { a } = bank(env)
    const z = env.repos.quizzes
    const quiz = z.create({ title: 'Q' })
    z.addQuestions(quiz.id, [a.id])
    z.delete(quiz.id)
    expect(z.get(quiz.id)).toBeNull()
    expect(env.repos.questions.get(a.id)).toMatchObject({ quizCount: 0 })
  })
})

describe('sending a quiz to the Gradebook', () => {
  function ready() {
    const env = makeEnv()
    const { cls, students } = seedClass(env)
    const { a, b } = bank(env)
    const quiz = env.repos.quizzes.create({ title: 'Quiz 3', date: '2026-10-02' })
    env.repos.quizzes.addQuestions(quiz.id, [a.id, b.id])
    env.events.length = 0
    return { env, cls, students, quiz }
  }

  it('creates an assignment worth the quiz total, tied back to the quiz', () => {
    const { env, cls, quiz } = ready()
    const cat = env.repos.grading.createCategory({ classId: cls.id, name: 'Quizzes', weight: 20 })
    env.events.length = 0
    const made = env.repos.quizzes.createAssignment({
      quizId: quiz.id,
      classId: cls.id,
      categoryId: cat.id
    })
    expect(made).toMatchObject({
      classId: cls.id,
      categoryId: cat.id,
      title: 'Quiz 3',
      pointsPossible: 3,
      dueDate: '2026-10-02',
      sourceApp: QUIZ_SOURCE_APP,
      sourceId: String(quiz.id)
    })
    expect(env.repos.quizzes.assignments(quiz.id).map((x) => x.id)).toEqual([made.id])
    expect(env.repos.quizzes.list()[0].assignmentCount).toBe(1)
    expect(env.events).toContainEqual({ name: 'assignments.changed', classId: cls.id })
    expect(env.events.map((e) => e.name)).toContain('quizzes.changed')
  })

  it('takes a different due date when given one, including none', () => {
    const { env, cls, quiz } = ready()
    const made = env.repos.quizzes.createAssignment({
      quizId: quiz.id,
      classId: cls.id,
      dueDate: '2026-10-09'
    })
    expect(made.dueDate).toBe('2026-10-09')
    const second = seedClass(env)
    expect(
      env.repos.quizzes.createAssignment({
        quizId: quiz.id,
        classId: second.cls.id,
        dueDate: null
      }).dueDate
    ).toBeNull()
  })

  it('makes one assignment per class and refuses a repeat', () => {
    const { env, cls, quiz } = ready()
    env.repos.quizzes.createAssignment({ quizId: quiz.id, classId: cls.id })
    expect(() => env.repos.quizzes.createAssignment({ quizId: quiz.id, classId: cls.id })).toThrow(
      /already in that class/
    )
    const other = seedClass(env)
    env.repos.quizzes.createAssignment({ quizId: quiz.id, classId: other.cls.id })
    expect(env.repos.quizzes.assignments(quiz.id)).toHaveLength(2)
    expect(env.repos.quizzes.list()[0].assignmentCount).toBe(2)
  })

  it('refuses an empty quiz, a missing class and another class’s category', () => {
    const { env, cls, quiz } = ready()
    const empty = env.repos.quizzes.create({ title: 'Empty' })
    expect(() => env.repos.quizzes.createAssignment({ quizId: empty.id, classId: cls.id })).toThrow(
      /Add questions worth points/
    )
    const free = env.repos.questions.create(mc('free', { points: 0 }))
    const zero = env.repos.quizzes.create({ title: 'Zero' })
    env.repos.quizzes.addQuestions(zero.id, [free.id])
    expect(() => env.repos.quizzes.createAssignment({ quizId: zero.id, classId: cls.id })).toThrow(
      /Add questions worth points/
    )
    expect(() => env.repos.quizzes.createAssignment({ quizId: quiz.id, classId: 9999 })).toThrow(
      /no longer exists/
    )
    const other = seedClass(env)
    const foreign = env.repos.grading.createCategory({
      classId: other.cls.id,
      name: 'Tests',
      weight: 10
    })
    expect(() =>
      env.repos.quizzes.createAssignment({
        quizId: quiz.id,
        classId: cls.id,
        categoryId: foreign.id
      })
    ).toThrow(/different class/)
    expect(env.repos.quizzes.assignments(quiz.id)).toEqual([])
  })

  it('keeps the assignment and its scores when the quiz is deleted, and unlinks it', () => {
    const { env, cls, students, quiz } = ready()
    const made = env.repos.quizzes.createAssignment({ quizId: quiz.id, classId: cls.id })
    env.repos.grading.setScore({
      assignmentId: made.id,
      studentId: students[0].id,
      points: 2,
      status: null
    })
    env.events.length = 0
    env.repos.quizzes.delete(quiz.id)
    const [kept] = env.repos.grading.assignments(cls.id)
    expect(kept).toMatchObject({ id: made.id, title: 'Quiz 3', sourceApp: null, sourceId: null })
    expect(env.repos.grading.scores(cls.id)).toHaveLength(1)
    expect(env.events).toContainEqual({ name: 'assignments.changed', classId: cls.id })
  })

  it('does not link a quiz to an assignment that merely has a look-alike source id', () => {
    const { env, cls, quiz } = ready()
    env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'Imported',
      pointsPossible: 5,
      sourceApp: 'other-app',
      sourceId: String(quiz.id)
    })
    expect(env.repos.quizzes.assignments(quiz.id)).toEqual([])
    expect(env.repos.quizzes.list()[0].assignmentCount).toBe(0)
  })
})
