import { useState } from 'react'
import { formatDate } from '@shared/advising'
import type { Question, QuizEntry, QuizKind } from '@shared/models'
import type { QuizVersion } from '@shared/quiz'
import { kindLabel, pointsLabel } from '@shared/quiz'
import ErrorBanner from '@renderer/components/ErrorBanner'
import { useApiQuery } from '@renderer/data/hooks'
import QuestionForm from './QuestionForm'
import QuestionPicker from './QuestionPicker'
import QuizGradebook from './QuizGradebook'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** One quiz or exam: its details, its questions in order, the Word export and the Gradebook link. */
export default function QuizEditor({
  quizId,
  onDeleted
}: {
  quizId: number
  onDeleted: () => void
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<Question | null>(null)
  const [exporting, setExporting] = useState<QuizVersion | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const quiz = useApiQuery(
    () => window.api.quizzes.get(quizId),
    [quizId],
    ['quizzes.changed', 'questions.changed']
  )
  const q = quiz.data
  if (!q) {
    return (
      <div className="placeholder">
        <strong>{quiz.loading ? 'Loading…' : 'That quiz no longer exists'}</strong>
      </div>
    )
  }

  const fail = (e: unknown): void => setError(msg(e))
  const move = (index: number, by: -1 | 1): void => {
    const ids = q.entries.map((e) => e.questionId)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    window.api.quizzes.reorder(q.id, ids).catch(fail)
  }
  const setPoints = (entry: QuizEntry, value: string): void => {
    const n = Number(value)
    if (value.trim() === '' || Number.isNaN(n) || n === entry.points) return
    // Back to the question's own value means "no override", so later edits to it still show up.
    window.api.quizzes
      .setPoints(q.id, entry.questionId, n === entry.question.points ? null : n)
      .catch(fail)
  }
  const exportWord = (version: QuizVersion): void => {
    setExporting(version)
    setSaved(null)
    window.api.quizzes
      .exportWord(q.id, version)
      .then((res) => setSaved(res?.path ?? null))
      .catch(fail)
      .finally(() => setExporting(null))
  }
  const remove = (): void => {
    if (
      !window.confirm(
        `Delete “${q.title}”? Its questions stay in the bank. Gradebook assignments made from it are kept.`
      )
    )
      return
    window.api.quizzes.delete(q.id).then(onDeleted).catch(fail)
  }

  return (
    <>
      <ErrorBanner message={error ?? quiz.error} onDismiss={() => setError(null)} />
      <div className="pane-head">
        <div>
          <h2>{q.title}</h2>
          <div className="hint">
            {q.entries.length} {q.entries.length === 1 ? 'question' : 'questions'} ·{' '}
            {pointsLabel(q.totalPoints)}
            {q.date && ` · ${formatDate(q.date)}`}
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      <QuizDetails key={q.id} quiz={q} onError={fail} />

      <section className="adv-section">
        <h3>
          Questions
          <button className="btn" onClick={() => setPicking(true)}>
            + Add questions
          </button>
        </h3>
        {q.entries.length === 0 ? (
          <p className="hint">No questions yet. Add some from the bank, or write new ones.</p>
        ) : (
          <ol className="qz-list">
            {q.entries.map((entry, i) => (
              <li key={entry.questionId} className="qz-item">
                <button
                  className="qz-prompt"
                  onClick={() => setEditing(entry.question)}
                  title="Edit this question"
                >
                  <span className="qb-prompt">{entry.question.prompt}</span>
                  <span className="qb-meta">{kindLabel(entry.question.kind)}</span>
                </button>
                <label className="qz-points">
                  <input
                    // Re-created when the value changes elsewhere, so it never shows a stale number.
                    key={`${entry.questionId}-${entry.points}`}
                    type="number"
                    min={0}
                    step="any"
                    defaultValue={entry.points}
                    aria-label={`Points for question ${i + 1}`}
                    onBlur={(e) => setPoints(entry, e.target.value)}
                  />
                  pts
                </label>
                {/* Always present, so the points boxes stay in one column. */}
                <span
                  className="quiz-warn qz-flag"
                  title={
                    entry.pointsOverride !== null
                      ? `The question itself is worth ${pointsLabel(entry.question.points)}`
                      : undefined
                  }
                >
                  {entry.pointsOverride !== null ? 'custom' : ''}
                </span>
                <button
                  className="btn btn-quiet"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move question ${i + 1} up`}
                >
                  Up
                </button>
                <button
                  className="btn btn-quiet"
                  disabled={i === q.entries.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move question ${i + 1} down`}
                >
                  Down
                </button>
                <button
                  className="btn btn-quiet"
                  onClick={() =>
                    window.api.quizzes.removeQuestion(q.id, entry.questionId).catch(fail)
                  }
                  aria-label={`Remove question ${i + 1}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="adv-section">
        <h3>Word documents</h3>
        <div className="adv-add">
          <button
            className="btn btn-primary"
            disabled={q.entries.length === 0 || exporting !== null}
            onClick={() => exportWord('student')}
          >
            {exporting === 'student' ? 'Saving…' : 'Student copy'}
          </button>
          <button
            className="btn"
            disabled={q.entries.length === 0 || exporting !== null}
            onClick={() => exportWord('key')}
          >
            {exporting === 'key' ? 'Saving…' : 'Answer key'}
          </button>
          {saved && (
            <span className="hint">
              Saved to {saved}{' '}
              <button className="link" onClick={() => window.api.files.reveal(saved).catch(fail)}>
                Show in folder
              </button>
            </span>
          )}
        </div>
      </section>

      <QuizGradebook quiz={q} onError={fail} />

      {picking && (
        <QuestionPicker
          quizId={q.id}
          inQuiz={q.entries.map((e) => e.questionId)}
          onClose={() => setPicking(false)}
        />
      )}
      {editing && <QuestionForm question={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** The fields that print at the top. Each saves as soon as you leave it. */
function QuizDetails({
  quiz,
  onError
}: {
  quiz: {
    id: number
    title: string
    course: string
    date: string | null
    kind: QuizKind
    instructions: string
  }
  onError: (e: unknown) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState({
    title: quiz.title,
    course: quiz.course,
    date: quiz.date ?? '',
    kind: quiz.kind,
    instructions: quiz.instructions
  })
  const current = {
    title: quiz.title,
    course: quiz.course,
    date: quiz.date ?? '',
    kind: quiz.kind,
    instructions: quiz.instructions
  }

  const commit = (field: keyof typeof draft, value: string): void => {
    if (value === current[field]) return
    window.api.quizzes
      .update(quiz.id, { [field]: field === 'date' ? value || null : value })
      .catch((e: unknown) => {
        onError(e)
        // Put back what is really saved, so the screen never claims something that was refused.
        setDraft((d) => ({ ...d, [field]: current[field] }))
      })
  }
  const bind = (field: keyof typeof draft) => ({
    value: draft[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setDraft((d) => ({ ...d, [field]: e.target.value })),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      commit(field, e.target.value)
  })

  return (
    <section className="adv-section">
      <h3>Details (printed at the top)</h3>
      <div className="form">
        <div className="form-row">
          <label>
            Title
            <input {...bind('title')} />
          </label>
          <label>
            Course
            <input {...bind('course')} />
          </label>
          <label>
            Date
            <input type="date" {...bind('date')} />
          </label>
          <label>
            Kind
            <select {...bind('kind')}>
              <option value="quiz">Quiz</option>
              <option value="exam">Exam</option>
            </select>
          </label>
        </div>
        <label>
          Instructions
          <textarea rows={2} {...bind('instructions')} />
        </label>
      </div>
    </section>
  )
}
