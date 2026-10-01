import { describe, expect, it } from 'vitest'
import {
  BLOCK_INFO,
  BLOCK_KINDS,
  agendaLine,
  blockKind,
  daysBetween,
  formatMinutes,
  minutesByKind,
  plannedMinutes,
  todoBucket
} from '@shared/lessonBlocks'

describe('lesson blocks', () => {
  it('describes every kind, with a positive length and prep for the kinds that need it', () => {
    for (const kind of BLOCK_KINDS) {
      expect(BLOCK_INFO[kind].label).not.toBe('')
      expect(BLOCK_INFO[kind].minutes).toBeGreaterThan(0)
    }
    expect(BLOCK_INFO.lecture.tasks.length).toBeGreaterThan(0)
    expect(BLOCK_INFO.break.tasks).toEqual([])
  })

  it('treats a kind it does not know as other', () => {
    expect(blockKind('lecture')).toBe('lecture')
    expect(blockKind('hologram')).toBe('other')
  })

  it('adds up the minutes, counting a block with no length as nothing', () => {
    expect(plannedMinutes([{ minutes: 20 }, { minutes: null }, { minutes: 15 }])).toBe(35)
    expect(plannedMinutes([])).toBe(0)
  })

  it('sums minutes by kind, largest first, leaving out kinds with none', () => {
    expect(
      minutesByKind([
        { kind: 'lecture', minutes: 20 },
        { kind: 'discussion', minutes: 30 },
        { kind: 'lecture', minutes: 15 },
        { kind: 'break', minutes: null },
        { kind: 'mystery', minutes: 5 }
      ])
    ).toEqual([
      { kind: 'lecture', minutes: 35 },
      { kind: 'discussion', minutes: 30 },
      { kind: 'other', minutes: 5 }
    ])
  })

  it('writes minutes as hours and minutes', () => {
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(75)).toBe('1 h 15 min')
  })

  it('writes an agenda line without repeating the kind', () => {
    expect(agendaLine({ kind: 'discussion', title: 'Trolleys', minutes: 15 })).toBe(
      'Discussion: Trolleys (15 min)'
    )
    expect(agendaLine({ kind: 'lecture', title: 'Lecture', minutes: 20 })).toBe('Lecture (20 min)')
    expect(agendaLine({ kind: 'break', title: ' ', minutes: null })).toBe('Break')
  })
})

describe('the to-do list', () => {
  const today = '2026-10-01'
  const bucket = (lessonDate: string | null, done = false) =>
    todoBucket({ done, lessonDate }, today)

  it('files a task by its lesson’s date', () => {
    expect(bucket('2026-09-30')).toBe('overdue')
    expect(bucket('2026-10-01')).toBe('today')
    expect(bucket('2026-10-02')).toBe('week')
    expect(bucket('2026-10-08')).toBe('week')
    expect(bucket('2026-10-09')).toBe('later')
    expect(bucket(null)).toBe('undated')
    expect(bucket('2026-09-01', true)).toBe('done')
  })

  it('counts days across a daylight-saving change and a year end', () => {
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-10-02', '2026-10-01')).toBe(-1)
  })
})
