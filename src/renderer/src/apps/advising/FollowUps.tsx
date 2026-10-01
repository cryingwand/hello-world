import { useState } from 'react'
import { formatDate, isOverdue, localToday } from '@shared/advising'
import type { ActionItem, ActionOwner, AdvisingGoal } from '@shared/models'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Follow-ups for one advisee: tick to finish, and a row to add another. When `meetingId` is given,
 * new items are tied to that meeting.
 */
export default function FollowUps({
  studentId,
  items,
  goals,
  meetingId,
  canAdd = true,
  empty = 'No follow-ups.',
  onError
}: {
  studentId: number
  items: ActionItem[]
  goals: AdvisingGoal[]
  meetingId?: number
  canAdd?: boolean
  empty?: string
  onError: (message: string) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState<ActionOwner>('student')
  const today = localToday()
  const goalTitle = (id: number | null): string | undefined => goals.find((g) => g.id === id)?.title

  const add = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!title.trim()) return
    window.api.advising
      .createAction({
        studentId,
        meetingId: meetingId ?? null,
        title,
        dueDate: due || null,
        owner
      })
      .then(() => {
        setTitle('')
        setDue('')
      })
      .catch((err: unknown) => onError(msg(err)))
  }

  return (
    <div>
      {items.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <ul className="adv-list">
          {items.map((a) => {
            const done = a.completedOn !== null
            const late = !done && isOverdue(a.dueDate, today)
            return (
              <li key={a.id} className={done ? 'adv-item adv-done' : 'adv-item'}>
                <input
                  type="checkbox"
                  checked={done}
                  aria-label={`Done: ${a.title}`}
                  onChange={(e) =>
                    window.api.advising
                      .updateAction(a.id, { done: e.target.checked })
                      .catch((err: unknown) => onError(msg(err)))
                  }
                />
                <span className="adv-grow">
                  {a.title}
                  {goalTitle(a.goalId) && <span className="hint"> · {goalTitle(a.goalId)}</span>}
                </span>
                <span className="badge">{a.owner === 'me' ? 'me' : 'student'}</span>
                {a.dueDate && (
                  <span className={late ? 'adv-flag' : 'hint'}>
                    {late ? 'Overdue ' : done ? '' : 'by '}
                    {formatDate(a.dueDate)}
                  </span>
                )}
                <button
                  className="btn btn-quiet"
                  aria-label={`Delete: ${a.title}`}
                  onClick={() =>
                    window.api.advising
                      .deleteAction(a.id)
                      .catch((err: unknown) => onError(msg(err)))
                  }
                >
                  Delete
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {canAdd && (
        <form className="adv-add" onSubmit={add}>
          <input
            type="text"
            placeholder="Add a follow-up"
            aria-label="New follow-up"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            type="date"
            aria-label="Due date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <select
            aria-label="Whose follow-up"
            value={owner}
            onChange={(e) => setOwner(e.target.value as ActionOwner)}
          >
            <option value="student">Student</option>
            <option value="me">Me</option>
          </select>
          <button type="submit" className="btn" disabled={!title.trim()}>
            Add
          </button>
        </form>
      )}
    </div>
  )
}
