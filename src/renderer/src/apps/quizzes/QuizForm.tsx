import { useState } from 'react'
import type { QuizKind } from '@shared/models'
import { localToday } from '@shared/advising'
import Modal from '@renderer/components/Modal'

export default function QuizForm({
  defaultCourse,
  onClose,
  onCreated
}: {
  /** The course of the last quiz, since most are written one course at a time. */
  defaultCourse: string
  onClose: () => void
  onCreated: (id: number) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<QuizKind>('quiz')
  const [course, setCourse] = useState(defaultCourse)
  const [date, setDate] = useState(localToday())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    try {
      const made = await window.api.quizzes.create({ title, kind, course, date: date || null })
      onCreated(made.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title="New quiz or exam"
      error={error}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="quiz-form" className="btn btn-primary" disabled={saving}>
            Create
          </button>
        </>
      }
    >
      <form id="quiz-form" className="form" onSubmit={save}>
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Quiz 3"
            autoFocus
            required
          />
        </label>
        <div className="form-row">
          <label>
            Course
            <input
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              placeholder="PHIL 101"
            />
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as QuizKind)}>
              <option value="quiz">Quiz</option>
              <option value="exam">Exam</option>
            </select>
          </label>
        </div>
      </form>
    </Modal>
  )
}
