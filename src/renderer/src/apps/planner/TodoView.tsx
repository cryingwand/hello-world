import { useState } from 'react'
import { formatDate, localToday } from '@shared/advising'
import { BLOCK_INFO, TODO_BUCKETS, blockKind, todoBucket } from '@shared/lessonBlocks'
import type { TodoItem } from '@shared/models'
import ErrorBanner from '@renderer/components/ErrorBanner'
import { useApiQuery } from '@renderer/data/hooks'
import { kindClass } from './RoadmapBar'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * The prep for every lesson in one list, made from the blocks the lessons are built from (and the
 * tasks added by hand). A task is due on its lesson's day: overdue, today, the next week, later, or
 * not dated yet. Ticking one off here ticks it off in its lesson.
 */
export default function TodoView({
  onOpen
}: {
  onOpen: (unitId: number, lessonId: number) => void
}): React.JSX.Element {
  const [showDone, setShowDone] = useState(false)
  const [chosenCourse, setCourse] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const todo = useApiQuery(() => window.api.units.todo(showDone), [showDone], ['planner.changed'])
  const all = todo.data ?? []
  const courses = [...new Set(all.map((t) => t.course))].sort((a, b) => a.localeCompare(b))
  // A course whose tasks are all gone (done, or deleted elsewhere) stops filtering.
  const course = chosenCourse !== null && courses.includes(chosenCourse) ? chosenCourse : null
  const items = course === null ? all : all.filter((t) => t.course === course)
  const today = localToday()

  const groups = new Map<string, TodoItem[]>()
  for (const t of items) {
    const b = todoBucket(t, today)
    groups.set(b, [...(groups.get(b) ?? []), t])
  }
  const left = items.filter((t) => !t.done).length
  const overdue = groups.get('overdue')?.length ?? 0

  return (
    <section className="pane todo">
      <ErrorBanner message={error ?? todo.error} onDismiss={() => setError(null)} />
      <div className="pane-head">
        <div>
          <h2>To-do</h2>
          <div className="hint">
            {left} to do{overdue > 0 && ` · ${overdue} overdue`}. Made from the blocks in your
            lessons; each is due on its lesson’s day.
          </div>
        </div>
        <div className="actions">
          {courses.length > 1 && (
            <select
              aria-label="Course"
              value={course ?? ''}
              onChange={(e) => setCourse(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c} value={c}>
                  {c || 'No course'}
                </option>
              ))}
            </select>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            Show done
          </label>
        </div>
      </div>

      {items.length === 0 && !todo.loading ? (
        <div className="placeholder">
          <strong>Nothing to do</strong>
          <span>Add blocks to a lesson (a lecture, a reading…) and their prep appears here.</span>
        </div>
      ) : (
        TODO_BUCKETS.filter((b) => groups.has(b.id)).map((b) => (
          <section key={b.id} className={`adv-section todo-group todo-${b.id}`}>
            <h3>
              {b.label}
              <span className="count">{groups.get(b.id)!.length}</span>
            </h3>
            <ul className="task-list">
              {groups.get(b.id)!.map((t) => (
                <li key={t.id} className={`task-row${t.done ? ' task-done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={t.done}
                    aria-label={`Done: ${t.text}`}
                    onChange={(e) =>
                      window.api.lessons
                        .updateTask(t.id, { done: e.target.checked })
                        .catch((err: unknown) => setError(msg(err)))
                    }
                  />
                  <span className="task-text-static">{t.text}</span>
                  {t.blockKind && (
                    <span className={`task-kind ${kindClass(t.blockKind)}`}>
                      <span className="kind-dot" />
                      {t.blockTitle || BLOCK_INFO[blockKind(t.blockKind)].label}
                    </span>
                  )}
                  <button
                    className="link todo-where"
                    onClick={() => onOpen(t.unitId, t.lessonId)}
                    title="Open the lesson"
                  >
                    {[t.lessonDate ? formatDate(t.lessonDate) : '', t.lessonTitle, t.course]
                      .filter((p) => p !== '')
                      .join(' · ')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  )
}
