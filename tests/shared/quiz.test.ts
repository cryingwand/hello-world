import { describe, expect, it } from 'vitest'
import {
  choiceLetter,
  examHeader,
  longDate,
  partsOf,
  pointsLabel,
  roman,
  sumPoints
} from '@shared/quiz'

describe('quiz helpers', () => {
  it('writes a date out the way the exam header wants it', () => {
    expect(longDate('2026-10-02')).toBe('October 2, 2026')
    expect(longDate('2026-12-31')).toBe('December 31, 2026')
    expect(longDate('2026-01-01')).toBe('January 1, 2026')
    expect(longDate(null)).toBe('')
    expect(longDate('2026-13-01')).toBe('')
    expect(longDate('nonsense')).toBe('')
  })

  it('builds the header from what is filled in', () => {
    expect(examHeader({ course: 'PHIL 101', title: 'Quiz 3', date: '2026-10-02' })).toBe(
      'PHIL 101 • Quiz 3 • October 2, 2026'
    )
    expect(examHeader({ course: ' ', title: 'Quiz 3', date: null })).toBe('Quiz 3')
    expect(examHeader({ course: 'PHIL 101', title: 'Final', date: null })).toBe('PHIL 101 • Final')
  })

  it('letters choices and numbers parts', () => {
    expect([0, 1, 5].map(choiceLetter)).toEqual(['a', 'b', 'f'])
    expect([1, 2, 3, 4, 5, 9, 10].map(roman)).toEqual(['I', 'II', 'III', 'IV', 'V', 'IX', 'X'])
  })

  it('formats and adds points', () => {
    expect(pointsLabel(1)).toBe('1 pt')
    expect(pointsLabel(2)).toBe('2 pts')
    expect(pointsLabel(0.5)).toBe('0.5 pts')
    expect(pointsLabel(0)).toBe('0 pts')
    expect(sumPoints([0.1, 0.2])).toBe(0.3)
    expect(sumPoints([])).toBe(0)
  })

  it('splits a list into runs of the same kind, keeping order', () => {
    const items = [
      { kind: 'multiple-choice', n: 1 },
      { kind: 'multiple-choice', n: 2 },
      { kind: 'essay', n: 3 },
      { kind: 'multiple-choice', n: 4 }
    ] as const
    const parts = partsOf([...items])
    expect(parts.map((p) => [p.kind, p.items.map((i) => i.n)])).toEqual([
      ['multiple-choice', [1, 2]],
      ['essay', [3]],
      ['multiple-choice', [4]]
    ])
    expect(partsOf([])).toEqual([])
  })
})
