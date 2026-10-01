import { describe, expect, it } from 'vitest'
import { chunkBullets, copiedDate, copyTitle, linesOf, shiftDate } from '@shared/lesson'

describe('linesOf', () => {
  it('keeps one entry per non-blank line, trimmed', () => {
    expect(linesOf('  Warm-up \n\n\nDiscuss  \r\nExit ticket\n')).toEqual([
      'Warm-up',
      'Discuss',
      'Exit ticket'
    ])
  })

  it('drops list markers that were typed, since the slide adds its own bullet', () => {
    expect(linesOf('- one\n* two\n• three\n1. four\n2) five\n10. six')).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six'
    ])
  })

  it('leaves a number or dash that is part of the text', () => {
    expect(linesOf('2026 plan\n-5 degrees\nRead 1. Kings\n3.14 is pi')).toEqual([
      '2026 plan',
      '-5 degrees',
      'Read 1. Kings',
      '3.14 is pi'
    ])
  })

  it('is empty for blank text', () => {
    expect(linesOf('')).toEqual([])
    expect(linesOf(' \n \n')).toEqual([])
  })
})

describe('chunkBullets', () => {
  const lines = (n: number): string[] => Array.from({ length: n }, (_, i) => `step ${i + 1}`)

  it('keeps a short list on one slide', () => {
    expect(chunkBullets(lines(3))).toEqual([lines(3)])
  })

  it('moves to a new slide when the budget is used, keeping the order', () => {
    const out = chunkBullets(lines(10), 4)
    expect(out.map((s) => s.length)).toEqual([4, 4, 2])
    expect(out.flat()).toEqual(lines(10))
  })

  it('counts a long bullet as several lines', () => {
    const long = 'x'.repeat(150) // wraps onto three lines at 70 characters
    expect(chunkBullets([long, 'a', 'b'], 4, 70)).toEqual([[long, 'a'], ['b']])
  })

  it('gives a bullet that is too long for any slide a slide of its own', () => {
    const huge = 'y'.repeat(2000)
    expect(chunkBullets(['a', huge, 'b'], 4, 70)).toEqual([['a'], [huge], ['b']])
  })

  it('has no slides for no bullets', () => {
    expect(chunkBullets([])).toEqual([])
  })
})

describe('shiftDate', () => {
  it('moves a date by whole days in either direction', () => {
    expect(shiftDate('2026-10-01', 7)).toBe('2026-10-08')
    expect(shiftDate('2026-10-01', 364)).toBe('2027-09-30')
    expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDate('2026-10-01', 0)).toBe('2026-10-01')
  })
  it('crosses month, year and leap-day boundaries', () => {
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31')
    expect(shiftDate('2027-02-28', 1)).toBe('2027-03-01')
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('does not move a day across a daylight-saving change', () => {
    expect(shiftDate('2026-03-07', 1)).toBe('2026-03-08')
    expect(shiftDate('2026-03-08', 1)).toBe('2026-03-09')
    expect(shiftDate('2026-11-01', 1)).toBe('2026-11-02')
  })
  it('gives null for no date or something that is not one', () => {
    expect(shiftDate(null, 3)).toBeNull()
    expect(shiftDate('soon', 3)).toBeNull()
  })
})

describe('copiedDate', () => {
  it('keeps, clears or shifts', () => {
    expect(copiedDate('2026-10-01', { mode: 'keep' })).toBe('2026-10-01')
    expect(copiedDate('2026-10-01', { mode: 'clear' })).toBeNull()
    expect(copiedDate('2026-10-01', { mode: 'shift', days: 14 })).toBe('2026-10-15')
    expect(copiedDate(null, { mode: 'shift', days: 14 })).toBeNull()
    expect(copiedDate(null, { mode: 'keep' })).toBeNull()
  })
})

describe('copyTitle', () => {
  it('adds (copy)', () => {
    expect(copyTitle('Day 1')).toBe('Day 1 (copy)')
  })
  it('cuts a long title so the copy still fits', () => {
    const t = copyTitle('x'.repeat(200))
    expect(t).toHaveLength(200)
    expect(t.endsWith('x (copy)')).toBe(true)
    expect(copyTitle('a'.repeat(193))).toHaveLength(200)
  })
})
