import type { QuizAssignmentInput, QuizInput } from '@shared/api'
import type { Assignment, Quiz, QuizDetail, QuizEntry, QuizKind, QuizSummary } from '@shared/models'
import { QUIZ_KINDS, QUIZ_SOURCE_APP, sumPoints } from '@shared/quiz'
import * as v from '../validate'
import type { gradingRepo } from './grading'
import { toQuestion, type QuestionRow } from './questions'
import type { Db, Emit } from './types'

interface QuizRow {
  id: number
  kind: QuizKind
  title: string
  course: string
  quiz_date: string | null
  instructions: string
}
interface SummaryRow extends QuizRow {
  question_count: number
  total_points: number
  assignment_count: number
}

const toQuiz = (r: QuizRow): Quiz => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  course: r.course,
  date: r.quiz_date,
  instructions: r.instructions
})

const MAX_QUESTIONS = 500

export function quizzesRepo(db: Db, emit: Emit, grading: ReturnType<typeof gradingRepo>) {
  const getQuiz = (id: number): Quiz | null => {
    const r = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id) as QuizRow | undefined
    return r ? toQuiz(r) : null
  }
  const mustQuiz = (id: number): Quiz => {
    const q = getQuiz(id)
    if (!q) throw new v.ValidationError('That quiz no longer exists')
    return q
  }

  const entries = (quizId: number): QuizEntry[] => {
    const rows = db
      .prepare(
        `SELECT i.position, i.points AS item_points, q.*,
           (SELECT COUNT(*) FROM quiz_items x WHERE x.question_id = q.id) AS quiz_count
         FROM quiz_items i JOIN questions q ON q.id = i.question_id
         WHERE i.quiz_id = ? ORDER BY i.position, i.id`
      )
      .all(quizId) as (QuestionRow & { position: number; item_points: number | null })[]
    return rows.map((r) => ({
      questionId: r.id,
      position: r.position,
      pointsOverride: r.item_points,
      points: r.item_points ?? r.points,
      question: toQuestion(r)
    }))
  }
  const detail = (id: number): QuizDetail => {
    const quiz = mustQuiz(id)
    const list = entries(id)
    return { ...quiz, entries: list, totalPoints: sumPoints(list.map((e) => e.points)) }
  }

  // Which quizzes use which question is part of both lists, so both screens refresh.
  const itemsChanged = (): void => {
    emit('quizzes.changed')
    emit('questions.changed')
  }
  const renumber = (quizId: number): void => {
    const ids = db
      .prepare('SELECT id FROM quiz_items WHERE quiz_id = ? ORDER BY position, id')
      .all(quizId) as { id: number }[]
    const set = db.prepare('UPDATE quiz_items SET position = ? WHERE id = ?')
    ids.forEach((r, i) => set.run(i, r.id))
  }
  const idList = (value: unknown, field: string): number[] => {
    if (!Array.isArray(value)) throw new v.ValidationError(`${field} must be a list`)
    if (value.length > MAX_QUESTIONS) throw new v.ValidationError('That is too many questions')
    return value.map((x) => v.id(x, 'Question'))
  }

  return {
    list(): QuizSummary[] {
      const rows = db
        .prepare(
          `SELECT z.*,
             (SELECT COUNT(*) FROM quiz_items i WHERE i.quiz_id = z.id) AS question_count,
             (SELECT COALESCE(SUM(COALESCE(i.points, q.points)), 0)
                FROM quiz_items i JOIN questions q ON q.id = i.question_id
                WHERE i.quiz_id = z.id) AS total_points,
             (SELECT COUNT(*) FROM assignments a
                WHERE a.source_app = ? AND a.source_id = CAST(z.id AS TEXT)) AS assignment_count
           FROM quizzes z ORDER BY COALESCE(z.quiz_date, '') DESC, z.id DESC`
        )
        .all(QUIZ_SOURCE_APP) as SummaryRow[]
      return rows.map((r) => ({
        ...toQuiz(r),
        questionCount: r.question_count,
        totalPoints: sumPoints([r.total_points]),
        assignmentCount: r.assignment_count
      }))
    },

    get(rawId: number): QuizDetail | null {
      const id = v.id(rawId)
      return getQuiz(id) ? detail(id) : null
    },

    create(input: QuizInput): QuizDetail {
      const res = db
        .prepare(
          'INSERT INTO quizzes (kind, title, course, quiz_date, instructions) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          input?.kind === undefined ? 'quiz' : v.oneOf(input.kind, QUIZ_KINDS, 'Kind'),
          v.reqStr(input?.title, 'Title', 200),
          v.optStr(input.course, 'Course', 200),
          v.dateOrNull(input.date, 'Date'),
          v.optStr(input.instructions, 'Instructions', 5000)
        )
      emit('quizzes.changed')
      return detail(Number(res.lastInsertRowid))
    },

    update(rawId: number, patch: Partial<QuizInput>): QuizDetail {
      const id = v.id(rawId)
      const cur = mustQuiz(id)
      db.prepare(
        'UPDATE quizzes SET kind = ?, title = ?, course = ?, quiz_date = ?, instructions = ? WHERE id = ?'
      ).run(
        patch.kind !== undefined ? v.oneOf(patch.kind, QUIZ_KINDS, 'Kind') : cur.kind,
        patch.title !== undefined ? v.reqStr(patch.title, 'Title', 200) : cur.title,
        patch.course !== undefined ? v.optStr(patch.course, 'Course', 200) : cur.course,
        patch.date !== undefined ? v.dateOrNull(patch.date, 'Date') : cur.date,
        patch.instructions !== undefined
          ? v.optStr(patch.instructions, 'Instructions', 5000)
          : cur.instructions,
        id
      )
      emit('quizzes.changed')
      return detail(id)
    },

    delete(rawId: number): void {
      const id = v.id(rawId)
      mustQuiz(id)
      const linked = grading.assignmentsFromSource(QUIZ_SOURCE_APP, String(id))
      const lessonCount = (
        db.prepare('SELECT COUNT(*) AS n FROM lesson_quizzes WHERE quiz_id = ?').get(id) as {
          n: number
        }
      ).n
      db.transaction(() => {
        // The Gradebook keeps the assignment and its scores; it just stops pointing at a quiz that is gone.
        db.prepare(
          'UPDATE assignments SET source_app = NULL, source_id = NULL WHERE source_app = ? AND source_id = ?'
        ).run(QUIZ_SOURCE_APP, String(id))
        // The lessons that used it lose the link with the quiz (it cascades).
        db.prepare('DELETE FROM quizzes WHERE id = ?').run(id)
      })()
      for (const classId of new Set(linked.map((a) => a.classId))) {
        emit('assignments.changed', { classId })
      }
      itemsChanged()
      if (lessonCount > 0) emit('planner.changed')
    },

    addQuestions(rawId: number, rawQuestionIds: number[]): QuizDetail {
      const id = v.id(rawId)
      mustQuiz(id)
      const ids = idList(rawQuestionIds, 'Questions')
      db.transaction(() => {
        const has = db.prepare('SELECT 1 FROM quiz_items WHERE quiz_id = ? AND question_id = ?')
        const exists = db.prepare('SELECT 1 FROM questions WHERE id = ?')
        let next = (
          db
            .prepare(
              'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM quiz_items WHERE quiz_id = ?'
            )
            .get(id) as { n: number }
        ).n
        const insert = db.prepare(
          'INSERT INTO quiz_items (quiz_id, question_id, position) VALUES (?, ?, ?)'
        )
        for (const questionId of ids) {
          if (!exists.get(questionId)) throw new v.ValidationError('That question no longer exists')
          if (has.get(id, questionId)) continue
          insert.run(id, questionId, next++)
        }
      })()
      itemsChanged()
      return detail(id)
    },

    removeQuestion(rawId: number, rawQuestionId: number): QuizDetail {
      const id = v.id(rawId)
      const questionId = v.id(rawQuestionId, 'Question')
      mustQuiz(id)
      db.transaction(() => {
        db.prepare('DELETE FROM quiz_items WHERE quiz_id = ? AND question_id = ?').run(
          id,
          questionId
        )
        renumber(id)
      })()
      itemsChanged()
      return detail(id)
    },

    reorder(rawId: number, rawQuestionIds: number[]): QuizDetail {
      const id = v.id(rawId)
      mustQuiz(id)
      const ids = idList(rawQuestionIds, 'Questions')
      const current = (
        db.prepare('SELECT question_id FROM quiz_items WHERE quiz_id = ?').all(id) as {
          question_id: number
        }[]
      ).map((r) => r.question_id)
      // The new order must be exactly the questions already in the quiz: no more, no fewer, no repeats.
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== current.length ||
        !current.every((q) => ids.includes(q))
      ) {
        throw new v.ValidationError('The new order must list each question in the quiz once')
      }
      db.transaction(() => {
        const set = db.prepare(
          'UPDATE quiz_items SET position = ? WHERE quiz_id = ? AND question_id = ?'
        )
        ids.forEach((questionId, i) => set.run(i, id, questionId))
      })()
      emit('quizzes.changed')
      return detail(id)
    },

    setPoints(rawId: number, rawQuestionId: number, points: number | null): QuizDetail {
      const id = v.id(rawId)
      const questionId = v.id(rawQuestionId, 'Question')
      mustQuiz(id)
      const res = db
        .prepare('UPDATE quiz_items SET points = ? WHERE quiz_id = ? AND question_id = ?')
        .run(points === null ? null : v.num(points, 'Points', 0), id, questionId)
      if (res.changes === 0) throw new v.ValidationError('That question is not in this quiz')
      emit('quizzes.changed')
      return detail(id)
    },

    assignments(rawId: number): Assignment[] {
      const id = v.id(rawId)
      mustQuiz(id)
      return grading.assignmentsFromSource(QUIZ_SOURCE_APP, String(id))
    },

    createAssignment(input: QuizAssignmentInput): Assignment {
      const quizId = v.id(input?.quizId, 'quizId')
      const classId = v.id(input.classId, 'classId')
      const quiz = detail(quizId)
      if (quiz.totalPoints <= 0) {
        throw new v.ValidationError('Add questions worth points before sending it to the Gradebook')
      }
      if (
        grading
          .assignmentsFromSource(QUIZ_SOURCE_APP, String(quizId))
          .some((a) => a.classId === classId)
      ) {
        throw new v.ValidationError('This quiz is already in that class’s Gradebook')
      }
      const assignment = grading.createAssignment({
        classId,
        categoryId: input.categoryId ?? null,
        title: quiz.title,
        pointsPossible: quiz.totalPoints,
        dueDate: input.dueDate !== undefined ? input.dueDate : quiz.date,
        sourceApp: QUIZ_SOURCE_APP,
        sourceId: String(quizId)
      })
      emit('quizzes.changed')
      return assignment
    }
  }
}
