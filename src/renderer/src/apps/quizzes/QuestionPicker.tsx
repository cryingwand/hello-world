import { useState } from 'react'
import Modal from '@renderer/components/Modal'
import QuestionBrowser from './QuestionBrowser'
import QuestionForm from './QuestionForm'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Choose questions from the bank to add to a quiz, or write a new one that goes straight in. */
export default function QuestionPicker({
  quizId,
  inQuiz,
  onClose
}: {
  quizId: number
  inQuiz: number[]
  onClose: () => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<number[]>([])
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const toggle = (id: number): void =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const add = async (ids: number[]): Promise<void> => {
    setAdding(true)
    try {
      await window.api.quizzes.addQuestions(quizId, ids)
      onClose()
    } catch (e) {
      setError(msg(e))
      setAdding(false)
    }
  }

  if (writing) {
    return (
      <QuestionForm
        onClose={() => setWriting(false)}
        // A question written from here is for this quiz, so it goes straight in.
        onSaved={(q) =>
          void window.api.quizzes.addQuestions(quizId, [q.id]).catch((e) => setError(msg(e)))
        }
      />
    )
  }

  return (
    <Modal
      title="Add questions"
      wide
      error={error}
      onClose={onClose}
      footer={
        <>
          <span className="hint">{selected.length} selected</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={selected.length === 0 || adding}
            onClick={() => add(selected)}
          >
            Add {selected.length > 0 ? selected.length : ''} to quiz
          </button>
        </>
      }
    >
      <QuestionBrowser
        mode="pick"
        excludeIds={inQuiz}
        selected={new Set(selected)}
        onToggle={toggle}
        extra={
          <button className="btn" onClick={() => setWriting(true)}>
            + New question
          </button>
        }
      />
    </Modal>
  )
}
