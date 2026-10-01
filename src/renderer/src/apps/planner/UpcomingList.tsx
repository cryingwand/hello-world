import { formatDate, localToday } from '@shared/advising'
import type { UpcomingLesson } from '@shared/models'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'

/** Dated lessons from today on, soonest first. Choosing one opens it in its unit. */
export default function UpcomingList({
  onOpen
}: {
  onOpen: (unitId: number, lessonId: number) => void
}): React.JSX.Element {
  const upcoming = useApiQuery(
    () => window.api.units.upcoming(),
    [],
    ['planner.changed', 'quizzes.changed', 'classes.changed', 'assignments.changed']
  )
  const list: UpcomingLesson[] = upcoming.data ?? []
  const today = localToday()

  return (
    <section className="pane pl-upcoming">
      <div className="pane-head">
        <h2>Coming up</h2>
      </div>
      {upcoming.error && <p className="hint">{upcoming.error}</p>}
      {list.length === 0 && !upcoming.loading ? (
        <div className="placeholder">
          <strong>Nothing coming up</strong>
          <span>Lessons with a date of today or later appear here.</span>
        </div>
      ) : (
        <ul className="adv-list">
          {list.map(({ lesson, unitTitle, course }) => (
            <li key={lesson.id} className="adv-item">
              <button
                className="pl-open"
                onClick={() => onOpen(lesson.unitId, lesson.id)}
                title="Open this lesson"
              >
                <span className="pl-name">
                  {lesson.title}
                  {lesson.date === today && <span className="pl-today"> Today</span>}
                </span>
                <span className="hint pl-meta">
                  {formatDate(lesson.date)} ·{' '}
                  {[course, unitTitle].filter((p) => p !== '').join(' · ')}
                  {lesson.classes.length > 0 &&
                    ` · ${lesson.classes.map((c) => classLabel(c)).join(', ')}`}
                  {lesson.quizzes.length > 0 &&
                    ` · ${lesson.quizzes.map((q) => q.title).join(', ')}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
