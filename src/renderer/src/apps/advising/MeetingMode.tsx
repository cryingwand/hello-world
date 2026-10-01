import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDate, meetingSummaryText } from '@shared/advising'
import type { AdvisingMeeting, Student } from '@shared/models'
import Modal from '@renderer/components/Modal'
import { fullName } from '@renderer/lib/labels'
import FollowUps from './FollowUps'
import { useAdviseeData } from './useAdviseeData'

interface Draft {
  metOn: string
  topic: string
  notes: string
  summary: string
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Running a meeting: what was agreed last time and what is still open on the left, this meeting's
 * notes on the right. Typing is saved as you go, so nothing is lost if the Vault locks.
 */
export default function MeetingMode({
  student,
  meetingId,
  onDone,
  onError
}: {
  student: Student
  meetingId: number
  onDone: () => void
  onError: (message: string) => void
}): React.JSX.Element {
  const data = useAdviseeData(student.id)
  const meeting = data.meetings.data?.find((m) => m.id === meetingId)

  if (!meeting) {
    return (
      <div className="pad">
        <button className="btn" onClick={onDone}>
          ← Back
        </button>
        <p className="hint pad">{data.meetings.data ? 'This meeting was deleted.' : 'Loading…'}</p>
      </div>
    )
  }
  // Keyed so each meeting starts from its own saved text and a refetch never overwrites typing.
  return (
    <Editor
      key={meeting.id}
      student={student}
      meeting={meeting}
      data={data}
      onDone={onDone}
      onError={onError}
    />
  )
}

function Editor({
  student,
  meeting,
  data,
  onDone,
  onError
}: {
  student: Student
  meeting: AdvisingMeeting
  data: ReturnType<typeof useAdviseeData>
  onDone: () => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>({
    metOn: meeting.metOn,
    topic: meeting.topic,
    notes: meeting.notes,
    summary: meeting.summary
  })
  const [copyText, setCopyText] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const persisted = useRef<Draft>(draft)
  const latest = useRef<Draft>(draft)
  useEffect(() => {
    latest.current = draft
  }, [draft])

  const flush = useCallback(async (): Promise<void> => {
    const d = latest.current
    const p = persisted.current
    if (
      d.metOn === p.metOn &&
      d.topic === p.topic &&
      d.notes === p.notes &&
      d.summary === p.summary
    )
      return
    if (!d.metOn) return // a cleared date waits until there is one
    persisted.current = d
    try {
      await window.api.advising.updateMeeting(meeting.id, d)
    } catch (err) {
      persisted.current = p
      onError(msg(err))
    }
  }, [meeting.id, onError])

  useEffect(() => {
    const t = setTimeout(() => void flush(), 700)
    return () => clearTimeout(t)
  }, [draft, flush])
  // Leaving the screen saves whatever has not been saved yet.
  useEffect(() => () => void flush(), [flush])

  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }))
  const goals = data.goals.data ?? []
  const actions = data.actions.data ?? []
  const fromThis = actions.filter((a) => a.meetingId === meeting.id)
  const stillOpen = actions.filter((a) => a.meetingId !== meeting.id && a.completedOn === null)
  const activeGoals = goals.filter((g) => g.status === 'active')
  const previous = (data.meetings.data ?? []).find(
    (m) =>
      m.id !== meeting.id &&
      (m.metOn < draft.metOn || (m.metOn === draft.metOn && m.id < meeting.id))
  )

  const copy = async (): Promise<void> => {
    await flush()
    const text = meetingSummaryText(fullName(student), draft, fromThis)
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Summary copied')
    } catch {
      setCopyText(text) // the clipboard can be refused; show the text to copy by hand
    }
  }
  const exportWord = async (): Promise<void> => {
    await flush() // the file should hold what is on screen
    setExporting(true)
    setNotice(null)
    try {
      const res = await window.api.advising.exportMeetingWord(meeting.id)
      if (res) setNotice(`Saved to ${res.path}`)
    } catch (err) {
      onError(msg(err))
    } finally {
      setExporting(false)
    }
  }
  const finish = async (): Promise<void> => {
    await flush()
    onDone()
  }
  const remove = async (): Promise<void> => {
    if (!window.confirm('Delete this meeting and its notes? Its follow-ups are kept.')) return
    persisted.current = latest.current // nothing left to save
    try {
      await window.api.advising.deleteMeeting(meeting.id)
      onDone()
    } catch (err) {
      onError(msg(err))
    }
  }

  return (
    <>
      <div className="pane-head">
        <div>
          <button className="btn btn-quiet" onClick={() => void finish()}>
            ← Back to {fullName(student)}
          </button>
          <h2>Meeting</h2>
          <div className="hint">Saved as you type.</div>
        </div>
        <div className="actions">
          {notice && <span className="hint">{notice}</span>}
          <button className="btn btn-danger" onClick={() => void remove()}>
            Delete
          </button>
          <button className="btn" onClick={() => void copy()}>
            Copy summary
          </button>
          <button
            className="btn"
            onClick={() => void exportWord()}
            disabled={exporting}
            title="A saved summary is an ordinary file with the student's name in it. It is not protected once it leaves the Vault."
          >
            {exporting ? 'Saving…' : 'Export to Word…'}
          </button>
          <button className="btn btn-primary" onClick={() => void finish()}>
            Done
          </button>
        </div>
      </div>

      <div className="meeting-mode">
        <aside className="meeting-context" aria-label="Before this meeting">
          <section className="adv-section">
            <h3>Last meeting</h3>
            {previous ? (
              <>
                <div className="hint">
                  {formatDate(previous.metOn)}
                  {previous.topic && ` · ${previous.topic}`}
                </div>
                <blockquote className="meeting-quote">
                  {previous.summary || previous.notes || 'No notes were written.'}
                </blockquote>
              </>
            ) : (
              <p className="hint">This is the first meeting.</p>
            )}
          </section>
          <section className="adv-section">
            <h3>Still open</h3>
            <FollowUps
              studentId={student.id}
              items={stillOpen}
              goals={goals}
              canAdd={false}
              empty="Nothing outstanding."
              onError={onError}
            />
          </section>
          <section className="adv-section">
            <h3>Goals</h3>
            {activeGoals.length === 0 ? (
              <p className="hint">No active goals.</p>
            ) : (
              <ul className="adv-list">
                {activeGoals.map((g) => (
                  <li key={g.id} className="adv-item">
                    <span className="adv-grow">{g.title}</span>
                    {g.targetDate && <span className="hint">{formatDate(g.targetDate)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="adv-section">
            <h3>Grades elsewhere</h3>
            {(data.progress.data ?? []).length === 0 ? (
              <p className="hint">None recorded.</p>
            ) : (
              <ul className="adv-list">
                {(data.progress.data ?? []).map((p) => (
                  <li key={p.id} className="adv-item">
                    <span className="adv-grow">
                      {p.course}
                      {p.term && <span className="hint"> · {p.term}</span>}
                    </span>
                    <strong>{p.grade}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <div className="meeting-work">
          <div className="form">
            <div className="form-row">
              <label>
                Date
                <input
                  type="date"
                  value={draft.metOn}
                  onChange={(e) => set({ metOn: e.target.value })}
                />
              </label>
              <label>
                Topic
                <input value={draft.topic} onChange={(e) => set({ topic: e.target.value })} />
              </label>
            </div>
            <label>
              Notes
              <textarea
                value={draft.notes}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder="What was said during the meeting"
                autoFocus
              />
            </label>
            <label>
              <span>
                Summary <span className="hint">(the tidy version to share or keep)</span>
              </span>
              <textarea value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
            </label>
          </div>
          <section className="adv-section">
            <h3>Follow-ups from this meeting</h3>
            <FollowUps
              studentId={student.id}
              items={fromThis}
              goals={goals}
              meetingId={meeting.id}
              empty="None yet."
              onError={onError}
            />
          </section>
        </div>
      </div>

      {copyText !== null && (
        <Modal
          title="Copy summary"
          onClose={() => setCopyText(null)}
          footer={
            <>
              <span className="spacer" />
              <button className="btn" onClick={() => setCopyText(null)}>
                Close
              </button>
            </>
          }
        >
          <p className="hint">The clipboard was not available. Select all and copy.</p>
          <textarea
            className="copy-text"
            readOnly
            value={copyText}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
        </Modal>
      )}
    </>
  )
}
