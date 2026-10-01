/**
 * The Mac's calendars (Apple Calendar: iCloud, Exchange, Google accounts added to the Mac), read and
 * written through EventKit in the main process. Times cross IPC as milliseconds since the epoch.
 */
export interface CalendarInfo {
  id: string
  title: string
  /** "#rrggbb". */
  color: string
  /** The account it belongs to: "iCloud", "Exchange"… */
  source: string
  writable: boolean
}

export interface CalendarEvent {
  /** EventKit's identifier. A repeating event's occurrences share it; `start` tells them apart. */
  id: string
  calendarId: string
  title: string
  start: number
  end: number
  allDay: boolean
  location: string
  /** Part of a repeating series. */
  recurring: boolean
}

export interface CalendarEventInput {
  calendarId: string
  title: string
  start: number
  end: number
  allDay?: boolean
  location?: string
  notes?: string
}

export type CalendarAccess = 'granted' | 'denied' | 'unavailable'

export interface CalendarStatus {
  access: CalendarAccess
  /** What to do about it, when access is not granted. */
  message?: string
}

/** Longest stretch one `events` call may ask for. */
export const MAX_RANGE_DAYS = 62

const DAY = 86_400_000

/** Midnight at the start of the Monday of the week holding `t`, in local time. */
export function weekStart(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  const back = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - back)
  return d.getTime()
}

/** Local midnight `n` days after `t`'s midnight. Built from the date, so a clock change never shifts it. */
export function addDays(t: number, n: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/** The event touches the day starting at `day` (local midnight). An event ending at midnight does not. */
export function onDay(e: { start: number; end: number }, day: number): boolean {
  const next = addDays(day, 1)
  return e.start < next && (e.end > day || (e.end === e.start && e.start >= day))
}

export interface Placed<T> {
  event: T
  /** Column among overlapping events, and how many columns the overlapping group needs. */
  column: number
  columns: number
}

/**
 * Side-by-side columns for a day's timed events, the way calendar apps lay out overlaps: each event
 * takes the first column free at its start, and a group of events that overlap shares one width.
 */
export function layoutDay<T extends { start: number; end: number }>(events: T[]): Placed<T>[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Placed<T>[] = []
  let group: Placed<T>[] = []
  let groupEnd = -Infinity
  const ends: number[] = []
  const close = (): void => {
    const n = Math.max(1, ...group.map((p) => p.column + 1))
    for (const p of group) p.columns = n
    group = []
    ends.length = 0
  }
  for (const e of sorted) {
    if (e.start >= groupEnd) {
      close()
      groupEnd = -Infinity
    }
    // An event shorter than a quarter hour still takes room on screen.
    const end = Math.max(e.end, e.start + 15 * 60_000)
    let col = ends.findIndex((t) => t <= e.start)
    if (col === -1) col = ends.length
    ends[col] = end
    const placed = { event: e, column: col, columns: 1 }
    group.push(placed)
    out.push(placed)
    groupEnd = Math.max(groupEnd, end)
  }
  close()
  return out
}

export const DAY_MS = DAY

/** A local date ("2026-10-01") and time ("09:30") as milliseconds; NaN for anything malformed. */
export function localTime(date: string, time = '00:00'): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!d || !t) return Number.NaN
  const [h, m] = [Number(t[1]), Number(t[2])]
  if (h > 23 || m > 59) return Number.NaN
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, m).getTime()
}

/** "2026-10-01" and "09:30" for a time, in local time: the values of date and time inputs. */
export function dateAndTime(t: number): { date: string; time: string } {
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`
  }
}
