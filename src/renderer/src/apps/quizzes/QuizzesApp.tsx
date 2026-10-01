import { useState } from 'react'
import { formatDate } from '@shared/advising'
import { pointsLabel } from '@shared/quiz'
import type { AppProps } from '@apps/types'
import { useApiQuery } from '@renderer/data/hooks'
import QuestionBank from './QuestionBank'
import QuizEditor from './QuizEditor'
import QuizForm from './QuizForm'

type Tab = 'quizzes' | 'bank'

export default function QuizzesApp({ intent, intentNonce }: AppProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('quizzes')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  // The shell can ask this app to open a quiz (`open-quiz`). Keyed on the nonce so a repeated
  // identical intent still applies once.
  const [handled, setHandled] = useState<number | undefined>(undefined)
  if (intent?.type === 'open-quiz' && intentNonce !== handled) {
    setHandled(intentNonce)
    setTab('quizzes')
    setSelectedId(intent.quizId)
  }

  const quizzes = useApiQuery(() => window.api.quizzes.list(), [], ['quizzes.changed'])
  const list = quizzes.data ?? []
  const current = list.find((z) => z.id === selectedId)

  const tabButton = (k: Tab, label: string): React.JSX.Element => (
    <button
      role="tab"
      aria-selected={tab === k}
      className={tab === k ? 'tab tab-on' : 'tab'}
      onClick={() => setTab(k)}
    >
      {label}
    </button>
  )

  return (
    <div className="quiz-app">
      <div className="tabs quiz-tabs" role="tablist">
        {tabButton('quizzes', 'Quizzes & exams')}
        {tabButton('bank', 'Question bank')}
      </div>
      <div className="quiz-body">
        {tab === 'bank' ? (
          <QuestionBank />
        ) : (
          <div className="split">
            <aside className="sidebar" aria-label="Quizzes">
              <div className="sidebar-actions">
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  + Quiz
                </button>
              </div>
              {list.map((z) => (
                <button
                  key={z.id}
                  className={`side-item quiz-side${current?.id === z.id ? ' side-active' : ''}`}
                  onClick={() => setSelectedId(z.id)}
                >
                  <span className="quiz-side-text">
                    <span className="adv-side-name">{z.title}</span>
                    <span className="hint quiz-side-meta">
                      {z.kind === 'exam' ? 'Exam' : 'Quiz'}
                      {z.date && ` · ${formatDate(z.date)}`} · {pointsLabel(z.totalPoints)}
                    </span>
                  </span>
                  <span className="count">{z.questionCount}</span>
                </button>
              ))}
              {list.length === 0 && !quizzes.loading && (
                <p className="hint side-empty">No quizzes yet.</p>
              )}
            </aside>
            <section className="pane">
              {quizzes.error && <p className="hint">{quizzes.error}</p>}
              {current ? (
                <QuizEditor
                  key={current.id}
                  quizId={current.id}
                  onDeleted={() => setSelectedId(null)}
                />
              ) : (
                <div className="placeholder">
                  <strong>{list.length > 0 ? 'Choose a quiz' : 'No quizzes yet'}</strong>
                  <span>
                    {list.length > 0
                      ? 'Pick one on the left to edit its questions or export it.'
                      : 'Create a quiz, then add questions from your bank.'}
                  </span>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {creating && (
        <QuizForm
          defaultCourse={list[0]?.course ?? ''}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setTab('quizzes')
            setSelectedId(id)
          }}
        />
      )}
    </div>
  )
}
