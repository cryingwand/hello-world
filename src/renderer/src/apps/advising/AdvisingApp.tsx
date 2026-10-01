import { useState } from 'react'
import { formatDate, isOverdue, localToday } from '@shared/advising'
import type { Student } from '@shared/models'
import type { AppProps } from '@apps/types'
import ErrorBanner from '@renderer/components/ErrorBanner'
import { useApiQuery } from '@renderer/data/hooks'
import { studentName } from '@renderer/lib/labels'
import AddAdviseeDialog from './AddAdviseeDialog'
import AdviseeView from './AdviseeView'

type Selection = { kind: 'followups' } | { kind: 'advisee'; id: number } | null

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export default function AdvisingApp({ intent, intentNonce }: AppProps): React.JSX.Element {
  const [selected, setSelected] = useState<Selection>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const advisees = useApiQuery(
    () => window.api.advising.advisees(),
    [],
    ['advising.changed', 'students.changed']
  )

  // The shell can ask this app to open someone (`open-advisee`). Keyed on the nonce so a repeated
  // identical intent still applies once.
  const [handled, setHandled] = useState<number | undefined>(undefined)
  if (intent?.type === 'open-advisee' && intentNonce !== handled) {
    setHandled(intentNonce)
    setSelected({ kind: 'advisee', id: intent.studentId })
  }

  const list = advisees.data ?? []
  const today = localToday()
  const current =
    selected?.kind === 'advisee' ? list.find((a) => a.student.id === selected.id) : undefined

  return (
    <div className="split">
      <aside className="sidebar" aria-label="Advisees">
        <div className="sidebar-actions">
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Advisee
          </button>
        </div>
        <button
          className={`side-item${selected?.kind === 'followups' ? ' side-active' : ''}`}
          onClick={() => setSelected({ kind: 'followups' })}
        >
          All follow-ups
          <span className="count">{list.reduce((n, a) => n + a.openActions, 0)}</span>
        </button>
        <div className="term-group">
          <div className="term-head">Advisees</div>
          {list.map((a) => {
            const late = isOverdue(a.nextDue, today)
            return (
              <button
                key={a.student.id}
                className={`side-item${current?.student.id === a.student.id ? ' side-active' : ''}`}
                onClick={() => setSelected({ kind: 'advisee', id: a.student.id })}
              >
                <span className="adv-side-name">{studentName(a.student)}</span>
                {a.openActions > 0 && (
                  <span className={late ? 'count adv-flag' : 'count'} title={late ? 'Overdue' : ''}>
                    {a.openActions}
                  </span>
                )}
              </button>
            )
          })}
          {list.length === 0 && !advisees.loading && (
            <p className="hint side-empty">
              No advisees yet. Add one, or give a student the “advisee” tag.
            </p>
          )}
        </div>
      </aside>

      <section className="pane">
        <ErrorBanner message={error ?? advisees.error} onDismiss={() => setError(null)} />
        {selected?.kind === 'followups' ? (
          <AllFollowUps
            advisees={list.map((a) => a.student)}
            onOpen={(id) => setSelected({ kind: 'advisee', id })}
          />
        ) : current ? (
          <AdviseeView key={current.student.id} student={current.student} onError={setError} />
        ) : selected?.kind === 'advisee' && !advisees.loading ? (
          <NotAdvisee studentId={selected.id} onError={setError} />
        ) : (
          <div className="placeholder">
            <strong>{list.length > 0 ? 'Choose an advisee' : 'No advisees yet'}</strong>
            <span>
              {list.length > 0
                ? 'Pick someone on the left to see their goals and start a meeting.'
                : 'Add an advisee to start keeping meeting notes and follow-ups.'}
            </span>
          </div>
        )}
      </section>

      {adding && (
        <AddAdviseeDialog
          onClose={() => setAdding(false)}
          onAdded={(s) => {
            setAdding(false)
            setSelected({ kind: 'advisee', id: s.id })
          }}
        />
      )}
    </div>
  )
}

/** Every open follow-up for every advisee, earliest due first. */
function AllFollowUps({
  advisees,
  onOpen
}: {
  advisees: Student[]
  onOpen: (studentId: number) => void
}): React.JSX.Element {
  const items = useApiQuery(() => window.api.advising.openActions(), [], ['advising.changed'])
  const today = localToday()
  const name = (id: number): string => {
    const s = advisees.find((a) => a.id === id)
    return s ? studentName(s) : ''
  }
  const rows = items.data ?? []
  return (
    <>
      <div className="pane-head">
        <div>
          <h2>All follow-ups</h2>
          <div className="hint">Everything still open, earliest due first.</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="hint">Nothing outstanding.</p>
      ) : (
        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Advisee</th>
                <th>Follow-up</th>
                <th>Whose</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => onOpen(a.studentId)}>
                  <td>{name(a.studentId)}</td>
                  <td>{a.title}</td>
                  <td>{a.owner === 'me' ? 'Me' : 'Student'}</td>
                  <td className={isOverdue(a.dueDate, today) ? 'adv-flag' : undefined}>
                    {formatDate(a.dueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** Reached by an `open-advisee` intent for a student who is not tagged `advisee`. */
function NotAdvisee({
  studentId,
  onError
}: {
  studentId: number
  onError: (message: string) => void
}): React.JSX.Element {
  const student = useApiQuery(
    () => window.api.students.get(studentId),
    [studentId],
    ['students.changed']
  )
  const s = student.data
  return (
    <div className="placeholder">
      <strong>{s ? `${studentName(s)} is not an advisee` : 'Student not found'}</strong>
      {s && (
        <button
          className="btn btn-primary"
          onClick={() =>
            window.api.students
              .update(s.id, { tags: [...s.tags, 'advisee'] })
              .catch((e: unknown) => onError(msg(e)))
          }
        >
          Make an advisee
        </button>
      )}
    </div>
  )
}
