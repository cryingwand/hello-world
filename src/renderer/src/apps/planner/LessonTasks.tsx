import { useState } from 'react'
import { BLOCK_INFO, blockKind } from '@shared/lessonBlocks'
import type { Lesson, LessonTask } from '@shared/models'
import { kindClass } from './RoadmapBar'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Everything to do before this lesson: the prep each block brought with it and anything added by
 * hand. All of it also shows in the To-do tab, due on the lesson's date.
 */
export default function LessonTasks({
  lesson,
  onError
}: {
  lesson: Lesson
  onError: (message: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const fail = (e: unknown): void => onError(msg(e))
  const open = lesson.tasks.filter((t) => !t.done).length

  const add = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!text.trim()) return
    window.api.lessons
      .addTask(lesson.id, { text })
      .then(() => setText(''))
      .catch(fail)
  }

  return (
    <section className="adv-section">
      <h3>
        Prep to-do
        <span className="count">
          {lesson.tasks.length === 0 ? '' : open === 0 ? 'All done' : `${open} left`}
        </span>
      </h3>
      {lesson.tasks.length > 0 && (
        <ul className="task-list">
          {lesson.tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              block={lesson.blocks.find((b) => b.id === t.blockId) ?? null}
              onError={fail}
            />
          ))}
        </ul>
      )}
      <form className="task-add" onSubmit={add}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add something to do before this lesson"
          aria-label="New task"
          maxLength={300}
        />
        <button className="btn" type="submit" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </section>
  )
}

/** A task's text can be changed in place: it saves when the field is left or Enter is pressed. */
function TaskRow({
  task,
  block,
  onError
}: {
  task: LessonTask
  block: Lesson['blocks'][number] | null
  onError: (e: unknown) => void
}): React.JSX.Element {
  const [text, setText] = useState(task.text)
  const save = (): void => {
    if (text.trim() === '') {
      setText(task.text)
      return
    }
    if (text !== task.text) window.api.lessons.updateTask(task.id, { text }).catch(onError)
  }
  const label = block ? BLOCK_INFO[blockKind(block.kind)].label : null
  return (
    <li className={`task-row${task.done ? ' task-done' : ''}`}>
      <input
        type="checkbox"
        checked={task.done}
        aria-label={`Done: ${task.text}`}
        onChange={(e) =>
          window.api.lessons.updateTask(task.id, { done: e.target.checked }).catch(onError)
        }
      />
      <input
        className="task-text"
        value={text}
        aria-label="Task"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {block && (
        <span className={`task-kind ${kindClass(block.kind)}`} title={block.title}>
          <span className="kind-dot" />
          {block.title && block.title !== label ? block.title : label}
        </span>
      )}
      <button
        className="btn btn-quiet"
        onClick={() => window.api.lessons.deleteTask(task.id).catch(onError)}
        aria-label={`Remove task: ${task.text}`}
      >
        ✕
      </button>
    </li>
  )
}
