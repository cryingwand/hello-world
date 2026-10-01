import { useState } from 'react'
import { dateAndTime, localTime, type CalendarInfo } from '@shared/calendar'
import Modal from '@renderer/components/Modal'
import { useApiQuery } from '@renderer/data/hooks'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export interface EventDraft {
  title: string
  start: number
  /** Minutes. */
  minutes: number
  allDay?: boolean
  location?: string
  notes?: string
}

const LAST_CALENDAR = 'teachingos.calendar.last.v1'
const lastCalendar = (): string | null => {
  try {
    return localStorage.getItem(LAST_CALENDAR)
  } catch {
    return null
  }
}

/**
 * A new event in one of the Mac's calendars. Used by the Calendar app and by the Lesson Planner's
 * "Add to Calendar". The calendar last used is remembered (in this window's storage only).
 */
export default function EventForm({
  draft,
  heading = 'New event',
  onClose,
  onSaved
}: {
  draft: EventDraft
  heading?: string
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const calendars = useApiQuery(() => window.api.calendar.calendars(), [], ['calendar.changed'])
  const writable: CalendarInfo[] = (calendars.data ?? []).filter((c) => c.writable)
  const start = dateAndTime(draft.start)
  const end = dateAndTime(draft.start + draft.minutes * 60_000)
  const [title, setTitle] = useState(draft.title)
  const [chosen, setChosen] = useState<string | null>(lastCalendar)
  const [date, setDate] = useState(start.date)
  const [from, setFrom] = useState(start.time)
  const [to, setTo] = useState(end.time)
  const [allDay, setAllDay] = useState(!!draft.allDay)
  const [location, setLocation] = useState(draft.location ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const calendarId = writable.some((c) => c.id === chosen) ? chosen : (writable[0]?.id ?? null)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!calendarId) return setError('There is no calendar that can be added to')
    const s = localTime(date, allDay ? '00:00' : from)
    let t = allDay ? s + 86_400_000 : localTime(date, to)
    if (!allDay && t <= s) t += 86_400_000 // ends after midnight
    if (Number.isNaN(s) || Number.isNaN(t)) return setError('Check the date and times')
    setSaving(true)
    try {
      await window.api.calendar.create({
        calendarId,
        title,
        start: s,
        end: t,
        allDay,
        location,
        notes: draft.notes
      })
      try {
        localStorage.setItem(LAST_CALENDAR, calendarId)
      } catch {
        // A convenience only.
      }
      onSaved()
    } catch (err) {
      setError(msg(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={heading}
      error={error ?? calendars.error}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="event-form"
            className="btn btn-primary"
            disabled={saving || !calendarId}
          >
            Add
          </button>
        </>
      }
    >
      <form id="event-form" className="form" onSubmit={save}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </label>
        <label>
          Calendar
          <select
            value={calendarId ?? ''}
            onChange={(e) => setChosen(e.target.value)}
            disabled={writable.length === 0}
          >
            {writable.length === 0 && (
              <option value="">{calendars.loading ? 'Loading…' : 'No calendars'}</option>
            )}
            {writable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.source ? ` (${c.source})` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {!allDay && (
            <>
              <label>
                From
                <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>
        <label>
          Location
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Room 204"
          />
        </label>
      </form>
    </Modal>
  )
}
