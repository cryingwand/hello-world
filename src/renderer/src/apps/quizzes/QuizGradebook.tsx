import { useState } from 'react'
import { formatDate } from '@shared/advising'
import type { QuizDetail } from '@shared/models'
import { pointsLabel } from '@shared/quiz'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The Gradebook assignments made from a quiz, and a way to make one in another class. */
export default function QuizGradebook({
  quiz,
  onError
}: {
  quiz: QuizDetail
  onError: (message: string) => void
}): React.JSX.Element {
  const [classId, setClassId] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  // Null follows the quiz's own date until a different one is typed.
  const [due, setDue] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const made = useApiQuery(
    () => window.api.quizzes.assignments(quiz.id),
    [quiz.id],
    ['assignments.changed', 'quizzes.changed']
  )
  const classes = useApiQuery(
    () => window.api.classes.list(),
    [],
    ['classes.changed', 'enrollments.changed']
  )
  const categories = useApiQuery(
    () => (classId === '' ? Promise.resolve([]) : window.api.grading.categories(classId)),
    [classId],
    ['categories.changed']
  )

  const linked = made.data ?? []
  const all = classes.data ?? []
  const label = (id: number): string => {
    const c = all.find((x) => x.id === id)
    return c ? `${classLabel(c)} (${c.termName})` : 'A class that no longer exists'
  }
  const taken = new Set(linked.map((a) => a.classId))
  const open = all.filter((c) => !taken.has(c.id))
  const empty = quiz.totalPoints <= 0

  const create = (): void => {
    if (classId === '') return
    setBusy(true)
    window.api.quizzes
      .createAssignment({
        quizId: quiz.id,
        classId,
        categoryId: categoryId === '' ? null : categoryId,
        dueDate: (due ?? quiz.date) || null
      })
      .then(() => {
        setClassId('')
        setCategoryId('')
        setDue(null)
      })
      .catch((e: unknown) => onError(msg(e)))
      .finally(() => setBusy(false))
  }

  return (
    <section className="adv-section">
      <h3>Gradebook</h3>
      {linked.length > 0 && (
        <ul className="adv-list">
          {linked.map((a) => (
            <li key={a.id} className="adv-item">
              <span className="adv-grow">
                {label(a.classId)}
                <span className="hint">
                  {' '}
                  · {pointsLabel(a.pointsPossible)}
                  {a.dueDate && ` · due ${formatDate(a.dueDate)}`}
                </span>
              </span>
              {a.pointsPossible !== quiz.totalPoints && (
                <>
                  <span className="quiz-warn">
                    Gradebook has {pointsLabel(a.pointsPossible)}; the quiz is{' '}
                    {pointsLabel(quiz.totalPoints)}
                  </span>
                  <button
                    className="btn"
                    onClick={() =>
                      window.api.grading
                        .updateAssignment(a.id, { pointsPossible: quiz.totalPoints })
                        .catch((e: unknown) => onError(msg(e)))
                    }
                  >
                    Match the quiz
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {open.length === 0 ? (
        <p className="hint">
          {all.length === 0
            ? 'Add a class in Classes & Rosters to send this quiz to its Gradebook.'
            : 'It is in the Gradebook of every class.'}
        </p>
      ) : (
        <div className="adv-add">
          <select
            aria-label="Class"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value === '' ? '' : Number(e.target.value))
              setCategoryId('')
            }}
          >
            <option value="">Send to a class…</option>
            {open.map((c) => (
              <option key={c.id} value={c.id}>
                {classLabel(c)} ({c.termName})
              </option>
            ))}
          </select>
          {classId !== '' && (
            <>
              <select
                aria-label="Category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">No category</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                aria-label="Due date"
                value={due ?? quiz.date ?? ''}
                onChange={(e) => setDue(e.target.value)}
              />
              <button className="btn btn-primary" disabled={busy || empty} onClick={create}>
                Add to Gradebook
              </button>
            </>
          )}
          {empty && <span className="hint">Add questions worth points first.</span>}
        </div>
      )}
    </section>
  )
}
