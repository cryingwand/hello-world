import { useEffect, useRef, useState } from 'react'
import {
  addDays,
  layoutDay,
  onDay,
  weekStart,
  type CalendarEvent,
  type CalendarInfo
} from '@shared/calendar'
import ErrorBanner from '@renderer/components/ErrorBanner'
import { useApiQuery } from '@renderer/data/hooks'
import EventForm, { type EventDraft } from './EventForm'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The hours drawn; earlier or later events are pinned to the edge. */
const FIRST_HOUR = 6
const LAST_HOUR = 23
const HOUR_PX = 48
/** Calendar.app and the school's calendar change without telling us; look again this often. */
const REFRESH_MS = 3 * 60_000
const HIDDEN_KEY = 'teachingos.calendar.hidden.v1'

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' })
const rangeFormat = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function loadHidden(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * The Mac's calendars (iCloud, Exchange, Google, whatever is set up in Calendar) as a week. Events
 * come from EventKit, so repeating classes show on every date. Click an empty slot to add an event
 * there; click an event to see it or delete it.
 */
export default function CalendarApp(): React.JSX.Element {
  const [week, setWeek] = useState(() => weekStart(Date.now()))
  const [hidden, setHidden] = useState<Set<string>>(loadHidden)
  const [adding, setAdding] = useState<EventDraft | null>(null)
  const [open, setOpen] = useState<CalendarEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  // The time, a minute at a time: the red line and "today" move on their own.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const status = useApiQuery(() => window.api.calendar.status(), [])
  const granted = status.data?.access === 'granted'
  const calendars = useApiQuery(
    () => (granted ? window.api.calendar.calendars() : Promise.resolve([] as CalendarInfo[])),
    [granted],
    ['calendar.changed']
  )
  const events = useApiQuery(
    () =>
      granted
        ? window.api.calendar.events(week, addDays(week, 7))
        : Promise.resolve([] as CalendarEvent[]),
    [granted, week],
    ['calendar.changed']
  )
  const reload = events.reload
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS)
    return () => clearInterval(t)
  }, [reload])
  // Open at the start of the school day rather than at 6 in the morning.
  useEffect(() => {
    if (granted && grid.current) grid.current.scrollTop = (8 - FIRST_HOUR) * HOUR_PX
  }, [granted])

  const byId = new Map((calendars.data ?? []).map((c) => [c.id, c]))
  const shown = (events.data ?? []).filter((e) => !hidden.has(e.calendarId))
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const today = addDays(now, 0)

  const toggle = (id: string): void => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHidden(next)
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]))
    } catch {
      // A convenience only.
    }
  }
  const remove = (e: CalendarEvent): void => {
    const what = e.recurring ? `this occurrence of “${e.title}”` : `“${e.title}”`
    if (!window.confirm(`Delete ${what} from your calendar?`)) return
    window.api.calendar
      .delete(e.id, e.start)
      .then(() => setOpen(null))
      .catch((err: unknown) => setError(msg(err)))
  }

  if (!status.data || !granted) {
    return (
      <div className="placeholder">
        <strong>{status.loading ? 'Opening your calendars…' : 'Calendar is not available'}</strong>
        <span>{status.data?.message ?? status.error ?? ''}</span>
        {status.data?.access === 'denied' && (
          <button className="btn" onClick={status.reload}>
            Try again
          </button>
        )}
      </div>
    )
  }

  const lastDay = addDays(week, 6)
  return (
    <div className="split cal">
      <aside className="sidebar cal-side" aria-label="Calendars">
        <div className="sidebar-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              // The next half hour this week, or 9 o'clock on the Monday of another week.
              const now = Date.now()
              const base = week === weekStart(now) ? now : week + 9 * 3_600_000
              setAdding({ title: '', start: Math.ceil(base / 1_800_000) * 1_800_000, minutes: 60 })
            }}
          >
            + Event
          </button>
        </div>
        <div className="term-head">Calendars</div>
        {(calendars.data ?? []).map((c) => (
          <label key={c.id} className="check cal-toggle" title={c.source}>
            <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="cal-swatch" style={{ background: c.color }} />
            {c.title}
          </label>
        ))}
        {open && (
          <section className="cal-detail" aria-label="Event">
            <h3>{open.title || '(No title)'}</h3>
            <p className="hint">
              {open.allDay
                ? 'All day'
                : `${timeFormat.format(open.start)} – ${timeFormat.format(open.end)}`}
              {' · '}
              {rangeFormat.format(open.start)}
            </p>
            {open.location && <p>{open.location}</p>}
            <p className="hint">
              {byId.get(open.calendarId)?.title}
              {open.recurring && ' · repeats'}
            </p>
            <div className="actions">
              {byId.get(open.calendarId)?.writable && (
                <button className="btn btn-danger" onClick={() => remove(open)}>
                  Delete
                </button>
              )}
              <button className="btn" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </section>
        )}
      </aside>

      <section className="pane cal-pane">
        <ErrorBanner
          message={error ?? events.error ?? calendars.error}
          onDismiss={() => setError(null)}
        />
        <div className="pane-head cal-head">
          <h2>
            {rangeFormat.format(week)} – {rangeFormat.format(lastDay)}
          </h2>
          <div className="actions">
            <button
              className="btn"
              onClick={() => setWeek(addDays(week, -7))}
              aria-label="Previous week"
            >
              ‹
            </button>
            <button className="btn" onClick={() => setWeek(weekStart(Date.now()))}>
              Today
            </button>
            <button
              className="btn"
              onClick={() => setWeek(addDays(week, 7))}
              aria-label="Next week"
            >
              ›
            </button>
            <button className="btn btn-quiet" onClick={reload} title="Look again">
              Refresh
            </button>
          </div>
        </div>

        <div className="cal-grid" ref={grid}>
          {/* Inside the scrolling area, so the day names line up with their columns. */}
          <div className="cal-sticky">
            <div className="cal-days">
              <span />
              {days.map((d) => (
                <div key={d} className={`cal-day-name${d === today ? ' cal-today' : ''}`}>
                  {dayFormat.format(d)}
                </div>
              ))}
            </div>
            <div className="cal-days cal-allday">
              <span className="hint">all day</span>
              {days.map((d) => (
                <div key={d}>
                  {shown
                    .filter((e) => e.allDay && onDay(e, d))
                    .map((e) => (
                      <button
                        key={`${e.id}:${e.start}`}
                        className="cal-chip"
                        style={{ ['--cal' as string]: byId.get(e.calendarId)?.color }}
                        onClick={() => setOpen(e)}
                      >
                        {e.title}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div className="cal-days" style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
            <div className="cal-hours">
              {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
                <span key={i} style={{ top: i * HOUR_PX }}>
                  {timeFormat.format(new Date(2000, 0, 1, FIRST_HOUR + i))}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const timed = shown.filter((e) => !e.allDay && onDay(e, d))
              const top = d + FIRST_HOUR * 3_600_000
              const y = (t: number): number =>
                Math.min(
                  Math.max(((t - top) / 3_600_000) * HOUR_PX, 0),
                  (LAST_HOUR - FIRST_HOUR) * HOUR_PX
                )
              return (
                <div
                  key={d}
                  className={`cal-col${d === today ? ' cal-today' : ''}`}
                  onDoubleClick={(e) => {
                    if (e.target !== e.currentTarget) return
                    const r = e.currentTarget.getBoundingClientRect()
                    // The half hour clicked; the window may be zoomed, so measure on screen.
                    const frac = (e.clientY - r.top) / r.height
                    const half = Math.floor(frac * (LAST_HOUR - FIRST_HOUR) * 2)
                    setAdding({ title: '', start: top + half * 1_800_000, minutes: 60 })
                  }}
                  title="Double-click to add an event"
                >
                  {d === today && (
                    <span className="cal-now" style={{ top: y(now) }} aria-hidden="true" />
                  )}
                  {layoutDay(timed).map(({ event: e, column, columns }) => (
                    <button
                      key={`${e.id}:${e.start}`}
                      className="cal-event"
                      style={{
                        top: y(Math.max(e.start, d)),
                        height: Math.max(
                          y(Math.min(e.end, addDays(d, 1))) - y(Math.max(e.start, d)),
                          18
                        ),
                        left: `${(column / columns) * 100}%`,
                        width: `${100 / columns}%`,
                        ['--cal' as string]: byId.get(e.calendarId)?.color
                      }}
                      onClick={() => setOpen(e)}
                      title={`${e.title}${e.location ? ` · ${e.location}` : ''}`}
                    >
                      <strong>{e.title || '(No title)'}</strong>
                      <span>{timeFormat.format(e.start)}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {adding && (
        <EventForm draft={adding} onClose={() => setAdding(null)} onSaved={() => setAdding(null)} />
      )}
    </div>
  )
}
