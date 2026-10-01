import type { QuestionInput, QuestionQuery } from '@shared/api'
import type { Question, QuestionKind } from '@shared/models'
import { MAX_CHOICES, MIN_CHOICES, QUESTION_KINDS, TRUE_FALSE_CHOICES } from '@shared/quiz'
import * as v from '../validate'
import type { Db, Emit } from './types'

export interface QuestionRow {
  id: number
  kind: QuestionKind
  prompt: string
  choices: string
  correct_choice: number | null
  answer: string
  points: number
  tags: string
  quiz_count: number
}

export const toQuestion = (r: QuestionRow): Question => ({
  id: r.id,
  kind: r.kind,
  prompt: r.prompt,
  choices: JSON.parse(r.choices) as string[],
  correctChoice: r.correct_choice,
  answer: r.answer,
  points: r.points,
  tags: JSON.parse(r.tags) as string[],
  quizCount: r.quiz_count
})

/** Every read carries how many quizzes use the question. */
const QUESTION_SELECT = `SELECT q.*, (SELECT COUNT(*) FROM quiz_items i WHERE i.question_id = q.id) AS quiz_count
   FROM questions q`

/**
 * The choices and right answer a kind allows. True/false always has its two fixed choices; the open
 * kinds have none. Anything a kind does not use is dropped rather than stored.
 */
function shape(
  kind: QuestionKind,
  rawChoices: unknown,
  rawCorrect: unknown
): { choices: string[]; correctChoice: number | null } {
  if (kind === 'short-answer' || kind === 'essay') return { choices: [], correctChoice: null }

  let choices: string[]
  if (kind === 'true-false') {
    choices = [...TRUE_FALSE_CHOICES]
  } else {
    if (!Array.isArray(rawChoices)) throw new v.ValidationError('Choices must be a list')
    if (rawChoices.length < MIN_CHOICES || rawChoices.length > MAX_CHOICES) {
      throw new v.ValidationError(`Give between ${MIN_CHOICES} and ${MAX_CHOICES} choices`)
    }
    choices = rawChoices.map((c) => {
      if (typeof c !== 'string' || c.trim() === '') {
        throw new v.ValidationError('Every choice needs some text')
      }
      if (c.trim().length > 500) throw new v.ValidationError('A choice is too long')
      return c.trim()
    })
  }
  if (typeof rawCorrect !== 'number' || !Number.isInteger(rawCorrect)) {
    throw new v.ValidationError('Mark which choice is correct')
  }
  if (rawCorrect < 0 || rawCorrect >= choices.length) {
    throw new v.ValidationError('The correct choice is not one of the choices')
  }
  return { choices, correctChoice: rawCorrect }
}

export function questionsRepo(db: Db, emit: Emit) {
  const get = (id: number): Question | null => {
    const r = db.prepare(`${QUESTION_SELECT} WHERE q.id = ?`).get(id) as QuestionRow | undefined
    return r ? toQuestion(r) : null
  }
  const must = (id: number): Question => {
    const q = get(id)
    if (!q) throw new v.ValidationError('That question no longer exists')
    return q
  }
  // A quiz's totals and printed text depend on its questions, so its screens refresh too.
  const changed = (): void => {
    emit('questions.changed')
    emit('quizzes.changed')
  }

  return {
    list(query: QuestionQuery = {}): Question[] {
      const where: string[] = []
      const params: unknown[] = []
      const search = typeof query.search === 'string' ? query.search.trim() : ''
      if (search) {
        where.push(`(q.prompt LIKE ? ESCAPE '\\' OR q.choices LIKE ? ESCAPE '\\')`)
        const pattern = v.likePattern(search)
        params.push(pattern, pattern)
      }
      if (query.kind !== undefined) {
        where.push('q.kind = ?')
        params.push(v.oneOf(query.kind, QUESTION_KINDS, 'Kind'))
      }
      if (typeof query.tag === 'string' && query.tag.trim()) {
        where.push('EXISTS (SELECT 1 FROM json_each(q.tags) WHERE value = ?)')
        params.push(query.tag.trim().toLowerCase())
      }
      const sql = `${QUESTION_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
         ORDER BY q.id DESC`
      return (db.prepare(sql).all(...params) as QuestionRow[]).map(toQuestion)
    },

    get,

    create(input: QuestionInput): Question {
      const kind = v.oneOf(input?.kind, QUESTION_KINDS, 'Kind')
      const { choices, correctChoice } = shape(kind, input.choices, input.correctChoice)
      const res = db
        .prepare(
          `INSERT INTO questions (kind, prompt, choices, correct_choice, answer, points, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          kind,
          v.reqStr(input.prompt, 'Question', 5000),
          JSON.stringify(choices),
          correctChoice,
          v.optStr(input.answer, 'Answer', 5000),
          input.points === undefined ? 1 : v.num(input.points, 'Points', 0),
          JSON.stringify(v.tags(input.tags))
        )
      changed()
      return must(Number(res.lastInsertRowid))
    },

    update(rawId: number, patch: Partial<QuestionInput>): Question {
      const id = v.id(rawId)
      const cur = must(id)
      // Validate the whole question as it will be, so changing the kind cannot leave stale choices.
      const kind = patch.kind !== undefined ? v.oneOf(patch.kind, QUESTION_KINDS, 'Kind') : cur.kind
      const { choices, correctChoice } = shape(
        kind,
        patch.choices !== undefined ? patch.choices : cur.choices,
        patch.correctChoice !== undefined ? patch.correctChoice : cur.correctChoice
      )
      db.prepare(
        `UPDATE questions SET kind = ?, prompt = ?, choices = ?, correct_choice = ?, answer = ?,
           points = ?, tags = ? WHERE id = ?`
      ).run(
        kind,
        patch.prompt !== undefined ? v.reqStr(patch.prompt, 'Question', 5000) : cur.prompt,
        JSON.stringify(choices),
        correctChoice,
        patch.answer !== undefined ? v.optStr(patch.answer, 'Answer', 5000) : cur.answer,
        patch.points !== undefined ? v.num(patch.points, 'Points', 0) : cur.points,
        JSON.stringify(patch.tags !== undefined ? v.tags(patch.tags) : cur.tags),
        id
      )
      changed()
      return must(id)
    },

    delete(rawId: number): void {
      const id = v.id(rawId)
      const cur = must(id)
      if (cur.quizCount > 0) {
        throw new v.ValidationError(
          `This question is in ${cur.quizCount} ${cur.quizCount === 1 ? 'quiz' : 'quizzes'}. ` +
            'Take it out of them first.'
        )
      }
      db.prepare('DELETE FROM questions WHERE id = ?').run(id)
      changed()
    }
  }
}
