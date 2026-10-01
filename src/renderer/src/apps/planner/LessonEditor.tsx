import { useState } from 'react'
import type { Lesson } from '@shared/models'
import { useApiQuery } from '@renderer/data/hooks'
import AttachedFiles from './AttachedFiles'
import ClassLinks from './ClassLinks'
import LessonBuilder from './LessonBuilder'
import LessonTasks from './LessonTasks'
import QuizLinks from './QuizLinks'
import { useAutosave } from './useAutosave'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** One lesson: its fields save as you type, its blocks and prep, then its quizzes and files. */
export default function LessonEditor({
  lesson,
  unitId,
  onError,
  onDeleted,
  onCopied,
  onMoved,
  onExport,
  exporting
}: {
  lesson: Lesson
  unitId: number
  onError: (message: string) => void
  onDeleted: () => void
  /** The lesson was copied: show the copy. */
  onCopied: (lessonId: number) => void
  /** The lesson was moved to this unit: show it there. */
  onMoved: (unitId: number) => void
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
      notes: lesson.notes,
      classMinutes: lesson.classMinutes === null ? '' : String(lesson.classMinutes)
    },
    (patch) => {
      const { date, classMinutes, ...rest } = patch
      return window.api.lessons.update(lesson.id, {
        ...rest,
        ...(date !== undefined ? { date: date || null } : {}),
        ...(classMinutes !== undefined
          ? { classMinutes: classMinutes === '' ? null : Number(classMinutes) }
          : {})
      })
    },
    (e) => onError(msg(e))
  )

  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const units = useApiQuery(() => window.api.units.list(), [], ['planner.changed'])
  const others = (units.data ?? []).filter((u) => u.id !== unitId)

  const copy = async (): Promise<void> => {
    setBusy(true)
    try {
      await flush() // the copy should hold what is on screen
      onCopied((await window.api.lessons.duplicate(lesson.id)).id)
    } catch (e) {
      onError(msg(e))
    } finally {
      setBusy(false)
    }
  }
  const moveTo = async (target: number): Promise<void> => {
    setBusy(true)
    try {
      await flush()
      await window.api.lessons.move(lesson.id, target)
      onMoved(target)
    } catch (e) {
      onError(msg(e))
      setBusy(false)
    }
  }
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
          <button className="btn" disabled={busy} onClick={() => void copy()}>
            Copy lesson
          </button>
          <select
            aria-label="Move this lesson to another unit"
            value=""
            disabled={busy || others.length === 0}
            onChange={(e) => e.target.value && void moveTo(Number(e.target.value))}
          >
            <option value="">Move to…</option>
            {others.map((u) => (
              <option key={u.id} value={u.id}>
                {u.course ? `${u.course}: ` : ''}
                {u.title}
              </option>
            ))}
          </select>
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
          <label>
            Class length (min)
            <input
              type="number"
              min={1}
              max={600}
              step={5}
              placeholder="75"
              {...bind('classMinutes')}
            />
          </label>
        </div>
      </div>
      <LessonBuilder lesson={lesson} onError={onError} />
      <LessonTasks lesson={lesson} onError={onError} />
      <div className="form">
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
      <ClassLinks lesson={lesson} onError={onError} />
      <AttachedFiles recordType="lesson" recordId={lesson.id} onError={onError} />
    </div>
  )
}
