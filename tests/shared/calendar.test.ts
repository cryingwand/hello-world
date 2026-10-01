import { describe, expect, it } from 'vitest'
import { addDays, dateAndTime, layoutDay, localTime, onDay, weekStart } from '@shared/calendar'

const at = (d: string, h = 0, m = 0): number => {
  const [y, mo, day] = d.split('-').map(Number)
  return new Date(y, mo - 1, day, h, m).getTime()
}

describe('calendar weeks', () => {
  it('starts a week on Monday at midnight', () => {
    expect(weekStart(at('2026-10-01', 15))).toBe(at('2026-09-28')) // a Thursday
    expect(weekStart(at('2026-10-04', 23))).toBe(at('2026-09-28')) // the Sunday
    expect(weekStart(at('2026-10-05', 0, 1))).toBe(at('2026-10-05')) // the next Monday
  })

  it('adds days by the calendar, so a clock change never shifts midnight', () => {
    expect(addDays(at('2026-10-31'), 2)).toBe(at('2026-11-02'))
    expect(addDays(at('2026-03-07', 12), 1)).toBe(at('2026-03-08'))
  })

  it('puts an event on the days it touches, and not on the day it ends at midnight', () => {
    const e = { start: at('2026-10-01', 22), end: at('2026-10-02') }
    expect(onDay(e, at('2026-10-01'))).toBe(true)
    expect(onDay(e, at('2026-10-02'))).toBe(false)
    const allDay = { start: at('2026-10-03'), end: at('2026-10-05') }
    expect([3, 4, 5].map((d) => onDay(allDay, at(`2026-10-0${d}`)))).toEqual([true, true, false])
  })
})

describe('laying out a day', () => {
  it('puts overlapping events side by side and the rest full width', () => {
    const a = { id: 'a', start: at('2026-10-01', 9), end: at('2026-10-01', 10) }
    const b = { id: 'b', start: at('2026-10-01', 9, 30), end: at('2026-10-01', 11) }
    const c = { id: 'c', start: at('2026-10-01', 10), end: at('2026-10-01', 10, 30) }
    const d = { id: 'd', start: at('2026-10-01', 13), end: at('2026-10-01', 14) }
    const out = Object.fromEntries(
      layoutDay([d, c, b, a]).map((p) => [p.event.id, [p.column, p.columns]])
    )
    expect(out).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] })
  })
})

describe('date and time fields', () => {
  it('turns a local date and time into a time and back', () => {
    const t = localTime('2026-10-01', '09:30')
    expect(t).toBe(at('2026-10-01', 9, 30))
    expect(dateAndTime(t)).toEqual({ date: '2026-10-01', time: '09:30' })
    expect(localTime('2026-10-01')).toBe(at('2026-10-01'))
  })

  it('refuses what is not a date or a time', () => {
    for (const [d, t] of [
      ['10/01/2026', '09:00'],
      ['2026-10-01', '25:00'],
      ['2026-10-01', '9am']
    ])
      expect(localTime(d, t)).toBeNaN()
  })
})
