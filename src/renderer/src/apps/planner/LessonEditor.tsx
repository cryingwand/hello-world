import { useState } from 'react'
import type { Lesson } from '@shared/models'
import AttachedFiles from './AttachedFiles'
import QuizLinks from './QuizLinks'
import { useAutosave } from './useAutosave'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** One lesson: its fields save as you type, then its quizzes and files. */
export default function LessonEditor({
  lesson,
  onError,
  onDeleted,
  onExport,
  exporting
}: {
  lesson: Lesson
  onError: (message: string) => void
  onDeleted: () => void
  onExport: () => void
  exporting: boolean
}): React.JSX.Element {
  const { draft, set, flush } = useAutosave(
    {
      title: lesson.title,
      date: lesson.date ?? '',
      objectives: lesson.objectives,
      plan: lesson.plan,
      homework: lesson.homework,
      notes: lesson.notes
    },
    (patch) => {
      const { date, ...rest } = patch
      return window.api.lessons.update(lesson.id, {
        ...rest,
        ...(date !== undefined ? { date: date || null } : {})
      })
    },
    (e) => onError(msg(e))
  )

  const [removing, setRemoving] = useState(false)
  const remove = (): void => {
    if (
      !window.confirm(
        `Delete “${lesson.title}”? Its attached files stay on disk and the quizzes it uses are not touched.`
      )
    )
      return
    setRemoving(true)
    window.api.lessons
      .delete(lesson.id)
      .then(onDeleted)
      .catch((e: unknown) => {
        onError(msg(e))
        setRemoving(false)
      })
  }
  const bind = (field: keyof typeof draft) => ({
    value: draft[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(field, e.target.value),
    onBlur: flush
  })

  return (
    <div className="pl-lesson">
      <div className="pane-head">
        <h3 className="pl-lesson-title">Lesson</h3>
        <div className="actions">
          <button className="btn" disabled={exporting} onClick={onExport}>
            {exporting ? 'Saving…' : 'PowerPoint for this lesson'}
          </button>
          <button className="btn btn-danger" disabled={removing} onClick={remove}>
            Delete lesson
          </button>
        </div>
      </div>
      <div className="form">
        <div className="form-row">
          <label className="pl-grow">
            Title
            <input {...bind('title')} />
          </label>
          <label>
            Date
            <input type="date" {...bind('date')} />
          </label>
        </div>
        <label>
          Objectives (one per line)
          <textarea rows={3} {...bind('objectives')} />
        </label>
        <label>
          Plan (one step per line)
          <textarea rows={6} {...bind('plan')} />
        </label>
        <label>
          Homework
          <textarea rows={2} {...bind('homework')} />
        </label>
        <label>
          Notes for me
          <textarea rows={3} {...bind('notes')} />
          <span className="hint">
            Never shown on a slide. They become the speaker notes in the PowerPoint.
          </span>
        </label>
      </div>
      <QuizLinks lesson={lesson} onError={onError} />
      <AttachedFiles recordType="lesson" recordId={lesson.id} onError={onError} />
    </div>
  )
}
