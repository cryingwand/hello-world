import { useState } from 'react'
import { formatDate } from '@shared/advising'
import type { Lesson } from '@shared/models'
import { useShell } from '@renderer/shell/ShellContext'
import { useApiQuery } from '@renderer/data/hooks'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The quizzes and exams a lesson uses. Only their names are kept here; the questions stay in Quizzes. */
export default function QuizLinks({
  lesson,
  onError
}: {
  lesson: Lesson
  onError: (message: string) => void
}): React.JSX.Element {
  const { dispatchIntent } = useShell()
  const [choice, setChoice] = useState('')
  const quizzes = useApiQuery(() => window.api.quizzes.list(), [], ['quizzes.changed'])
  const linked = new Set(lesson.quizzes.map((q) => q.id))
  const available = (quizzes.data ?? []).filter((q) => !linked.has(q.id))

  const link = (): void => {
    if (choice === '') return
    window.api.lessons
      .linkQuiz(lesson.id, Number(choice))
      .then(() => setChoice(''))
      .catch((e: unknown) => onError(msg(e)))
  }

  return (
    <section className="adv-section">
      <h3>Quizzes and exams</h3>
      {lesson.quizzes.length === 0 ? (
        <p className="hint">None linked yet.</p>
      ) : (
        <ul className="adv-list">
          {lesson.quizzes.map((q) => (
            <li key={q.id} className="adv-item">
              <span className="adv-grow">
                <strong>{q.title}</strong>
                <span className="hint pl-path">
                  {q.kind === 'exam' ? 'Exam' : 'Quiz'}
                  {q.date && ` · ${formatDate(q.date)}`}
                </span>
              </span>
              <button
                className="btn btn-quiet"
                onClick={() => dispatchIntent({ type: 'open-quiz', quizId: q.id })}
              >
                Open
              </button>
              <button
                className="btn btn-quiet"
                onClick={() =>
                  window.api.lessons.unlinkQuiz(lesson.id, q.id).catch((e) => onError(msg(e)))
                }
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="adv-add">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Quiz or exam to link"
          disabled={available.length === 0}
        >
          <option value="">
            {available.length === 0 ? 'No other quizzes to link' : 'Choose a quiz or exam…'}
          </option>
          {available.map((q) => (
            <option key={q.id} value={q.id}>
              {q.kind === 'exam' ? 'Exam' : 'Quiz'}: {q.title}
              {q.date ? ` (${formatDate(q.date)})` : ''}
            </option>
          ))}
        </select>
        <button className="btn" disabled={choice === ''} onClick={link}>
          Link
        </button>
      </div>
    </section>
  )
}
