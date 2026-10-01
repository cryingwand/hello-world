import { describe, expect, it } from 'vitest'
import type { Question, QuestionKind, QuizDetail, QuizEntry } from '@shared/models'
import { quizForForm, versionSuffix } from '@shared/quizForms'

let nextId = 1
function question(kind: QuestionKind, prompt: string, over: Partial<Question> = {}): Question {
  const choices =
    kind === 'multiple-choice'
      ? ['alpha', 'beta', 'gamma', 'delta']
      : kind === 'true-false'
        ? ['True', 'False']
        : []
  return {
    id: nextId++,
    kind,
    prompt,
    choices,
    correctChoice: choices.length > 0 ? 1 : null,
    answer: '',
    points: 1,
    tags: [],
    quizCount: 1,
    ...over
  }
}
const entry = (q: Question, position: number): QuizEntry => ({
  questionId: q.id,
  position,
  pointsOverride: null,
  points: q.points,
  question: q
})
function quiz(questions: Question[], id = 7): QuizDetail {
  const entries = questions.map((q, i) => entry(q, i + 1))
  return {
    id,
    kind: 'quiz',
    title: 'Quiz 3',
    course: 'PHIL 101',
    date: null,
    instructions: '',
    entries,
    totalPoints: entries.length
  }
}
const prompts = (q: QuizDetail): string[] => q.entries.map((e) => e.question.prompt)
const many = (kind: QuestionKind, n: number, tag: string): Question[] =>
  Array.from({ length: n }, (_, i) => question(kind, `${tag}${i + 1}`))

describe('quizForForm', () => {
  it('leaves Form A, and a quiz with no form, exactly as built', () => {
    const q = quiz(many('multiple-choice', 5, 'm'))
    expect(quizForForm(q, 'A')).toBe(q)
    expect(quizForForm(q, null)).toBe(q)
    expect(quizForForm(q, undefined)).toBe(q)
  })

  it('shuffles the questions in Form B, keeping every one of them', () => {
    const q = quiz(many('multiple-choice', 8, 'm'))
    const b = quizForForm(q, 'B')
    expect(prompts(b)).not.toEqual(prompts(q))
    expect([...prompts(b)].sort()).toEqual([...prompts(q)].sort())
    expect(b.entries.map((e) => e.position)).toEqual(q.entries.map((e) => e.position))
    expect(b.totalPoints).toBe(q.totalPoints)
  })

  it('never hands back Form B identical to Form A, even for the smallest quiz', () => {
    const two = quiz(many('essay', 2, 'e'))
    expect(prompts(quizForForm(two, 'B'))).toEqual(['e2', 'e1'])
    for (let id = 1; id <= 40; id++) {
      const q = quiz(many('essay', 3, 'e'), id)
      expect(prompts(quizForForm(q, 'B'))).not.toEqual(prompts(q))
    }
  })

  it('is the same every time, so a key and its student copy agree', () => {
    const q = quiz(many('multiple-choice', 8, 'm'))
    expect(quizForForm(q, 'B')).toEqual(quizForForm(q, 'B'))
  })

  it('differs from one quiz to the next', () => {
    const orders = new Set<string>()
    for (let id = 1; id <= 12; id++) {
      orders.add(prompts(quizForForm(quiz(many('essay', 6, 'e'), id), 'B')).join())
    }
    expect(orders.size).toBeGreaterThan(6)
  })

  it('shuffles within each part, so the parts stay where they are', () => {
    const q = quiz([
      ...many('multiple-choice', 5, 'm'),
      ...many('short-answer', 4, 's'),
      ...many('essay', 3, 'e')
    ])
    const b = quizForForm(q, 'B')
    expect(b.entries.map((e) => e.question.kind)).toEqual(q.entries.map((e) => e.question.kind))
    expect(prompts(b).slice(0, 5).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
    expect(prompts(b).slice(5, 9).sort()).toEqual(['s1', 's2', 's3', 's4'])
    expect(prompts(b).slice(9).sort()).toEqual(['e1', 'e2', 'e3'])
  })

  it('shuffles choices and moves the right answer with its text', () => {
    const q = quiz(
      Array.from({ length: 12 }, (_, i) =>
        question('multiple-choice', `m${i + 1}`, {
          choices: ['alpha', 'beta', 'gamma', 'delta'],
          correctChoice: i % 4
        })
      )
    )
    const b = quizForForm(q, 'B')
    let moved = 0
    for (const e of b.entries) {
      const before = q.entries.find((x) => x.questionId === e.questionId)!.question
      expect([...e.question.choices].sort()).toEqual([...before.choices].sort())
      expect(e.question.choices[e.question.correctChoice!]).toBe(
        before.choices[before.correctChoice!]
      )
      if (e.question.choices.join() !== before.choices.join()) moved++
    }
    expect(moved).toBe(12) // every multiple-choice question changed order
  })

  it('does not touch the quiz it was given', () => {
    const q = quiz(many('multiple-choice', 6, 'm'))
    const copy = structuredClone(q)
    quizForForm(q, 'B')
    expect(q).toEqual(copy)
  })

  it('keeps True / False in its natural order and leaves open questions alone', () => {
    const q = quiz([question('true-false', 't1'), question('essay', 'e1', { answer: 'Model' })])
    const b = quizForForm(q, 'B')
    const tf = b.entries.find((e) => e.question.kind === 'true-false')!.question
    expect(tf.choices).toEqual(['True', 'False'])
    expect(tf.correctChoice).toBe(1)
    expect(b.entries.find((e) => e.question.kind === 'essay')!.question.answer).toBe('Model')
  })

  it('keeps "all of the above" and "none of these" as the last choices', () => {
    const q = quiz(
      Array.from({ length: 10 }, (_, i) =>
        question('multiple-choice', `m${i}`, {
          choices: ['red', 'green', 'blue', 'All of the above'],
          correctChoice: 3
        })
      )
    )
    for (const e of quizForForm(q, 'B').entries) {
      expect(e.question.choices[3]).toBe('All of the above')
      expect(e.question.correctChoice).toBe(3)
      expect(e.question.choices.slice(0, 3).sort()).toEqual(['blue', 'green', 'red'])
    }
    const none = quiz([
      question('multiple-choice', 'n', {
        choices: ['one', 'two', 'three', 'None of these'],
        correctChoice: 0
      })
    ])
    expect(quizForForm(none, 'B').entries[0].question.choices[3]).toBe('None of these')
  })

  it('leaves a question alone when its choices refer to each other by letter', () => {
    const q = quiz(
      Array.from({ length: 6 }, (_, i) =>
        question('multiple-choice', `m${i}`, {
          choices: ['one', 'two', 'Both A and B', 'Neither'],
          correctChoice: 2
        })
      )
    )
    for (const e of quizForForm(q, 'B').entries) {
      expect(e.question.choices).toEqual(['one', 'two', 'Both A and B', 'Neither'])
      expect(e.question.correctChoice).toBe(2)
    }
  })

  it('copes with a single question and with an empty quiz', () => {
    expect(prompts(quizForForm(quiz(many('essay', 1, 'e')), 'B'))).toEqual(['e1'])
    expect(quizForForm(quiz([]), 'B').entries).toEqual([])
  })
})

describe('versionSuffix', () => {
  it('names the form and the key', () => {
    expect(versionSuffix('student', null)).toBe('')
    expect(versionSuffix('key', null)).toBe('Answer Key')
    expect(versionSuffix('student', 'A')).toBe('Form A')
    expect(versionSuffix('key', 'B')).toBe('Form B Answer Key')
  })
})
