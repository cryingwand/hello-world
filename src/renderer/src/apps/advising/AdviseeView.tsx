import { useState } from 'react'
import { formatDate, localToday } from '@shared/advising'
import type { AdvisingGoal, ExternalProgress, Student } from '@shared/models'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel, fullName } from '@renderer/lib/labels'
import { useShell } from '@renderer/shell/ShellContext'
import FollowUps from './FollowUps'
import GoalForm from './GoalForm'
import MeetingMode from './MeetingMode'
import ProgressForm from './ProgressForm'
import { useAdviseeData } from './useAdviseeData'

type Tab = 'overview' | 'meetings' | 'progress'
type View = { kind: 'tabs' } | { kind: 'meeting'; id: number }
type Dialog = { kind: 'goal'; goal?: AdvisingGoal } | { kind: 'progress'; entry?: ExternalProgress }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const STATUS_LABEL = { active: 'Active', achieved: 'Achieved', dropped: 'Dropped' } as const

/** One advisee: goals and follow-ups, past meetings, grades from elsewhere, and meeting mode. */
export default function AdviseeView({
  student,
  onError
}: {
  student: Student
  onError: (message: string) => void
}): React.JSX.Element {
  const { dispatchIntent } = useShell()
  const [tab, setTab] = useState<Tab>('overview')
  const [view, setView] = useState<View>({ kind: 'tabs' })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const data = useAdviseeData(student.id)
  const classes = useApiQuery(
    () => window.api.classes.forStudent(student.id),
    [student.id],
    ['enrollments.changed', 'classes.changed']
  )

  if (view.kind === 'meeting') {
    return (
      <MeetingMode
        student={student}
        meetingId={view.id}
        onDone={() => {
          setView({ kind: 'tabs' })
          setTab('meetings')
        }}
        onError={onError}
      />
    )
  }

  const meetings = data.meetings.data ?? []
  const goals = data.goals.data ?? []
  const actions = data.actions.data ?? []
  const progress = data.progress.data ?? []

  const startMeeting = (): void => {
    window.api.advising
      .createMeeting({ studentId: student.id, metOn: localToday() })
      .then((m) => setView({ kind: 'meeting', id: m.id }))
      .catch((e: unknown) => onError(msg(e)))
  }
  const stopAdvising = (): void => {
    if (
      !window.confirm(
        `Stop advising ${fullName(student)}? They stay in your student list, and their meetings, goals and follow-ups are kept if you add them back.`
      )
    )
      return
    window.api.students
      .update(student.id, { tags: student.tags.filter((t) => t !== 'advisee') })
      .catch((e: unknown) => onError(msg(e)))
  }

  const tabButton = (k: Tab, label: string): React.JSX.Element => (
    <button
      role="tab"
      aria-selected={tab === k}
      className={tab === k ? 'tab tab-on' : 'tab'}
      onClick={() => setTab(k)}
    >
      {label}
    </button>
  )

  return (
    <>
      <div className="pane-head">
        <div>
          <h2>{fullName(student)}</h2>
          <div className="hint">
            {(classes.data ?? []).length > 0
              ? classes.data!.map((c) => `${classLabel(c)} (${c.termName})`).join('; ')
              : 'Not in any class'}
            {student.email && ` · ${student.email}`}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={stopAdvising}>
            Stop advising
          </button>
          <button
            className="btn"
            onClick={() => dispatchIntent({ type: 'open-student', studentId: student.id })}
          >
            Open in Gradebook
          </button>
          <button className="btn btn-primary" onClick={startMeeting}>
            Start meeting
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" style={{ maxWidth: 420, marginBottom: 14 }}>
        {tabButton('overview', 'Overview')}
        {tabButton('meetings', `Meetings (${meetings.length})`)}
        {tabButton('progress', 'Grades elsewhere')}
      </div>

      {tab === 'overview' && (
        <>
          <section className="adv-section">
            <h3>
              Goals
              <button className="btn" onClick={() => setDialog({ kind: 'goal' })}>
                + Goal
              </button>
            </h3>
            {goals.length === 0 ? (
              <p className="hint">No goals yet.</p>
            ) : (
              <ul className="adv-list">
                {goals.map((g) => (
                  <li
                    key={g.id}
                    className={g.status === 'active' ? 'adv-item' : 'adv-item adv-done'}
                  >
                    <span className="adv-grow">
                      {g.title}
                      {g.details && <div className="hint">{g.details}</div>}
                    </span>
                    {g.status !== 'active' && (
                      <span className="badge">{STATUS_LABEL[g.status]}</span>
                    )}
                    {g.targetDate && <span className="hint">by {formatDate(g.targetDate)}</span>}
                    <button
                      className="btn btn-quiet"
                      onClick={() => setDialog({ kind: 'goal', goal: g })}
                      aria-label={`Edit goal: ${g.title}`}
                    >
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="adv-section">
            <h3>Follow-ups</h3>
            <FollowUps
              studentId={student.id}
              items={actions}
              goals={goals}
              empty="No follow-ups yet."
              onError={onError}
            />
          </section>
        </>
      )}

      {tab === 'meetings' &&
        (meetings.length === 0 ? (
          <p className="hint">No meetings yet. Start one when you sit down together.</p>
        ) : (
          <div className="table-scroll">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Topic</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr
                    key={m.id}
                    className="clickable"
                    onClick={() => setView({ kind: 'meeting', id: m.id })}
                  >
                    <td>{formatDate(m.metOn)}</td>
                    <td>{m.topic}</td>
                    <td className="hint">{(m.summary || m.notes).slice(0, 90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'progress' && (
        <section className="adv-section">
          <h3>
            Grades earned elsewhere
            <button className="btn" onClick={() => setDialog({ kind: 'progress' })}>
              + Grade
            </button>
          </h3>
          {progress.length === 0 ? (
            <p className="hint">
              Grades from outside this gradebook, such as another school or an online course, are
              recorded here by hand.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Term</th>
                    <th>Grade</th>
                    <th>Source</th>
                    <th>As of</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.map((p) => (
                    <tr
                      key={p.id}
                      className="clickable"
                      onClick={() => setDialog({ kind: 'progress', entry: p })}
                    >
                      <td>{p.course}</td>
                      <td>{p.term}</td>
                      <td>{p.grade}</td>
                      <td>{p.source}</td>
                      <td>{formatDate(p.recordedOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {dialog?.kind === 'goal' && (
        <GoalForm studentId={student.id} goal={dialog.goal} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'progress' && (
        <ProgressForm studentId={student.id} entry={dialog.entry} onClose={() => setDialog(null)} />
      )}
    </>
  )
}
