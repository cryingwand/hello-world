import { useState } from 'react'
import { formatDate } from '@shared/advising'
import { formatPoints } from '@shared/grades'
import type { Lesson, LinkedClass } from '@shared/models'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'
import { useShell } from '@renderer/shell/ShellContext'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * The classes a lesson is taught to and, under each, the Gradebook assignments that go with it (the
 * homework, the quiz). A link is only a pointer: nothing here changes the Gradebook.
 */
export default function ClassLinks({
  lesson,
  onError
}: {
  lesson: Lesson
  onError: (message: string) => void
}): React.JSX.Element {
  const [choice, setChoice] = useState('')
  const classes = useApiQuery(
    () => window.api.classes.list(),
    [],
    ['classes.changed', 'terms.changed']
  )
  const linked = new Set(lesson.classes.map((c) => c.id))
  const available = (classes.data ?? []).filter((c) => !linked.has(c.id))
  const fail = (e: unknown): void => onError(msg(e))

  const link = (): void => {
    if (choice === '') return
    window.api.lessons
      .linkClass(lesson.id, Number(choice))
      .then(() => setChoice(''))
      .catch(fail)
  }

  return (
    <section className="adv-section">
      <h3>Classes and Gradebook</h3>
      {lesson.classes.length === 0 ? (
        <p className="hint">Not linked to a class yet.</p>
      ) : (
        <ul className="adv-list">
          {lesson.classes.map((c) => (
            <ClassRow key={c.id} lesson={lesson} cls={c} onError={onError} />
          ))}
        </ul>
      )}
      <div className="adv-add">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Class to link"
          disabled={available.length === 0}
        >
          <option value="">
            {available.length === 0 ? 'No other classes to link' : 'Choose a class…'}
          </option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)} ({c.termName})
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

function ClassRow({
  lesson,
  cls,
  onError
}: {
  lesson: Lesson
  cls: LinkedClass
  onError: (message: string) => void
}): React.JSX.Element {
  const { dispatchIntent } = useShell()
  const [choice, setChoice] = useState('')
  const assignments = useApiQuery(
    () => window.api.grading.assignments(cls.id),
    [cls.id],
    ['assignments.changed']
  )
  const mine = lesson.assignments.filter((a) => a.classId === cls.id)
  const taken = new Set(mine.map((a) => a.id))
  const available = (assignments.data ?? []).filter((a) => !taken.has(a.id))
  const fail = (e: unknown): void => onError(msg(e))

  return (
    <li className="adv-item pl-class">
      <div className="adv-grow">
        <div className="pl-class-head">
          <strong>{classLabel(cls)}</strong>
          <span className="hint pl-path">{cls.termName}</span>
          <button
            className="btn btn-quiet"
            onClick={() => dispatchIntent({ type: 'open-gradebook', classId: cls.id })}
          >
            Open in Gradebook
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => window.api.lessons.unlinkClass(lesson.id, cls.id).catch(fail)}
            title="Also unlinks this lesson from the class's assignments"
          >
            Unlink
          </button>
        </div>
        {mine.length > 0 && (
          <ul className="adv-list">
            {mine.map((a) => (
              <li key={a.id} className="adv-item">
                <span className="adv-grow">
                  {a.title}
                  <span className="hint pl-path">
                    {formatPoints(a.pointsPossible)} pts
                    {a.dueDate && ` · due ${formatDate(a.dueDate)}`}
                  </span>
                </span>
                <button
                  className="btn btn-quiet"
                  onClick={() => window.api.lessons.unlinkAssignment(lesson.id, a.id).catch(fail)}
                  aria-label={`Unlink ${a.title}`}
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
            aria-label={`Assignment to link in ${classLabel(cls)}`}
            disabled={available.length === 0}
          >
            <option value="">
              {available.length === 0 ? 'No assignments to link' : 'Choose an assignment…'}
            </option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
                {a.dueDate ? ` (due ${formatDate(a.dueDate)})` : ''}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={choice === ''}
            onClick={() =>
              window.api.lessons
                .linkAssignment(lesson.id, Number(choice))
                .then(() => setChoice(''))
                .catch(fail)
            }
          >
            Link
          </button>
        </div>
      </div>
    </li>
  )
}
