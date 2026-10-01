import { describe, expect, it } from 'vitest'
import {
  roundTo,
  assignmentStats,
  classAverage,
  computeStudentGrade,
  contribution,
  formatPercent,
  formatPoints,
  round1,
  type AssignmentLike,
  type CategoryLike,
  type ScoreLike
} from '@shared/grades'

const A = (
  id: number,
  pointsPossible: number,
  categoryId: number | null = null
): AssignmentLike => ({ id, categoryId, pointsPossible })
const S = (points: number | null, status: ScoreLike['status'] = null): ScoreLike => ({
  points,
  status
})
const scoreMap = (entries: [number, ScoreLike][]): Map<number, ScoreLike> => new Map(entries)
const cats: CategoryLike[] = [
  { id: 1, name: 'Tests', weight: 60 },
  { id: 2, name: 'Homework', weight: 40 }
]

describe('contribution', () => {
  const a = A(1, 20)
  it('counts entered points out of points possible', () => {
    expect(contribution(S(15), a)).toEqual({ earned: 15, possible: 20 })
    expect(contribution(S(0), a)).toEqual({ earned: 0, possible: 20 })
  })
  it('does not count ungraded or absent scores', () => {
    expect(contribution(undefined, a)).toBeNull()
    expect(contribution(S(null), a)).toBeNull()
  })
  it('excused is not counted, even with points stored', () => {
    expect(contribution(S(null, 'excused'), a)).toBeNull()
    expect(contribution(S(18, 'excused'), a)).toBeNull()
  })
  it('missing counts as zero out of the points possible, whatever points are stored', () => {
    expect(contribution(S(null, 'missing'), a)).toEqual({ earned: 0, possible: 20 })
    expect(contribution(S(18, 'missing'), a)).toEqual({ earned: 0, possible: 20 })
  })
  it('late is only a flag: points count as entered, no points means ungraded', () => {
    expect(contribution(S(16, 'late'), a)).toEqual({ earned: 16, possible: 20 })
    expect(contribution(S(null, 'late'), a)).toBeNull()
  })
})

describe('points mode', () => {
  it('is total earned over total possible, not an average of percents', () => {
    // 10/10 and 1/50 -> 11/60 = 18.33%, not (100 + 2) / 2.
    const g = computeStudentGrade(
      'points',
      [A(1, 10), A(2, 50)],
      [],
      scoreMap([
        [1, S(10)],
        [2, S(1)]
      ])
    )
    expect(g.percent).toBeCloseTo(18.3333, 3)
    expect(g).toMatchObject({ earned: 11, possible: 60 })
  })

  it('ignores ungraded work and excused work', () => {
    const g = computeStudentGrade(
      'points',
      [A(1, 10), A(2, 10), A(3, 10)],
      [],
      scoreMap([
        [1, S(9)],
        [3, S(null, 'excused')]
      ])
    )
    expect(g.percent).toBe(90)
    expect(g.counts).toMatchObject({ total: 3, graded: 1, excused: 1, ungraded: 1 })
  })

  it('counts missing as zero', () => {
    const g = computeStudentGrade(
      'points',
      [A(1, 10), A(2, 10)],
      [],
      scoreMap([
        [1, S(10)],
        [2, S(null, 'missing')]
      ])
    )
    expect(g.percent).toBe(50)
    expect(g.counts).toMatchObject({ graded: 1, missing: 1, ungraded: 0 })
  })

  it('counts late points as entered and tallies the flag', () => {
    const g = computeStudentGrade(
      'points',
      [A(1, 10), A(2, 10)],
      [],
      scoreMap([
        [1, S(8, 'late')],
        [2, S(10)]
      ])
    )
    expect(g.percent).toBe(90)
    expect(g.counts.late).toBe(1)
    expect(g.counts.graded).toBe(2)
  })

  it('allows extra credit above 100%, including a 0-point extra credit assignment', () => {
    const g = computeStudentGrade(
      'points',
      [A(1, 10), A(2, 0)],
      [],
      scoreMap([
        [1, S(10)],
        [2, S(3)]
      ])
    )
    expect(g.percent).toBe(130)
  })

  it('is null when there is nothing to grade, and is not a divide-by-zero', () => {
    expect(computeStudentGrade('points', [], [], new Map()).percent).toBeNull()
    expect(computeStudentGrade('points', [A(1, 10)], [], new Map()).percent).toBeNull()
    expect(computeStudentGrade('points', [A(1, 0)], [], scoreMap([[1, S(0)]])).percent).toBeNull()
  })

  it('does not depend on categories, and still reports them', () => {
    const g = computeStudentGrade(
      'points',
      [A(1, 10, 1), A(2, 10, 2), A(3, 10, null)],
      cats,
      scoreMap([
        [1, S(10)],
        [2, S(5)],
        [3, S(0)]
      ])
    )
    expect(g.percent).toBe(50)
    expect(g.categories.map((c) => c.percent)).toEqual([100, 50])
  })

  it('has no float drift on sums like 0.1 + 0.2', () => {
    const g = computeStudentGrade(
      'points',
      [A(1, 0.3), A(2, 0.7)],
      [],
      scoreMap([
        [1, S(0.1)],
        [2, S(0.2)]
      ])
    )
    expect(round1(g.percent!)).toBe(30)
  })
})

describe('weighted mode', () => {
  const asg = [A(1, 100, 1), A(2, 50, 1), A(3, 10, 2), A(4, 10, 2)]

  it('weights category percents, not raw points', () => {
    // Tests: 90/150 = 60%; Homework: 20/20 = 100%. 0.6*60 + 0.4*100 = 76.
    const g = computeStudentGrade(
      'weighted',
      asg,
      cats,
      scoreMap([
        [1, S(50)],
        [2, S(40)],
        [3, S(10)],
        [4, S(10)]
      ])
    )
    expect(g.percent).toBeCloseTo(76, 6)
    expect(g.categories.map((c) => c.percent)).toEqual([60, 100])
  })

  it('rescales weights when a category has nothing graded yet', () => {
    const g = computeStudentGrade(
      'weighted',
      asg,
      cats,
      scoreMap([
        [3, S(9)],
        [4, S(9)]
      ])
    )
    expect(g.percent).toBe(90) // only Homework counts, so it is 100% of the grade
    expect(g.categories[0].percent).toBeNull()
  })

  it('excused work leaves its category untouched; an all-excused category drops out', () => {
    const g = computeStudentGrade(
      'weighted',
      asg,
      cats,
      scoreMap([
        [1, S(80)],
        [2, S(null, 'excused')],
        [3, S(null, 'excused')],
        [4, S(null, 'excused')]
      ])
    )
    expect(g.percent).toBe(80)
    expect(g.categories[1].percent).toBeNull()
  })

  it('missing drags a category down as a zero', () => {
    const g = computeStudentGrade(
      'weighted',
      asg,
      cats,
      scoreMap([
        [1, S(100)],
        [2, S(50)],
        [3, S(10)],
        [4, S(null, 'missing')]
      ])
    )
    // Tests 100%, Homework 10/20 = 50%: 0.6*100 + 0.4*50 = 80
    expect(g.percent).toBeCloseTo(80, 6)
  })

  it('does not need weights to add up to 100', () => {
    const c: CategoryLike[] = [
      { id: 1, name: 'A', weight: 3 },
      { id: 2, name: 'B', weight: 1 }
    ]
    const g = computeStudentGrade(
      'weighted',
      [A(1, 10, 1), A(2, 10, 2)],
      c,
      scoreMap([
        [1, S(10)],
        [2, S(0)]
      ])
    )
    expect(g.percent).toBe(75)
  })

  it('ignores zero-weight categories and reports null if that leaves nothing', () => {
    const c: CategoryLike[] = [
      { id: 1, name: 'Practice', weight: 0 },
      { id: 2, name: 'Tests', weight: 100 }
    ]
    const g = computeStudentGrade(
      'weighted',
      [A(1, 10, 1), A(2, 10, 2)],
      c,
      scoreMap([
        [1, S(0)],
        [2, S(10)]
      ])
    )
    expect(g.percent).toBe(100)
    expect(
      computeStudentGrade('weighted', [A(1, 10, 1)], c, scoreMap([[1, S(5)]])).percent
    ).toBeNull()
  })

  it('ignores uncategorised assignments and says how many', () => {
    const g = computeStudentGrade(
      'weighted',
      [A(1, 10, 1), A(2, 10, null)],
      cats,
      scoreMap([
        [1, S(10)],
        [2, S(0)]
      ])
    )
    expect(g.percent).toBe(100)
    expect(g.uncategorized).toBe(1)
  })

  it('is null with no graded work, and with no categories at all', () => {
    expect(computeStudentGrade('weighted', asg, cats, new Map()).percent).toBeNull()
    expect(
      computeStudentGrade('weighted', [A(1, 10, null)], [], scoreMap([[1, S(10)]])).percent
    ).toBeNull()
  })

  it('same data, different mode, different answer (the mode is what the class is set to)', () => {
    const scores = scoreMap([
      [1, S(50)],
      [2, S(40)],
      [3, S(10)],
      [4, S(10)]
    ])
    expect(computeStudentGrade('points', asg, cats, scores).percent).toBeCloseTo(
      (110 / 170) * 100,
      6
    )
    expect(computeStudentGrade('weighted', asg, cats, scores).percent).toBeCloseTo(76, 6)
  })
})

describe('classAverage', () => {
  it('averages only students who have a grade', () => {
    expect(classAverage([90, null, 70])).toBe(80)
    expect(classAverage([null, null])).toBeNull()
    expect(classAverage([])).toBeNull()
  })
})

describe('assignmentStats', () => {
  const a = A(1, 20)
  it('averages counted scores, treating missing as zero and skipping excused and ungraded', () => {
    const s = assignmentStats(a, [
      S(20),
      S(10),
      S(null, 'missing'),
      S(null, 'excused'),
      S(null),
      undefined
    ])
    expect(s).toMatchObject({ counted: 3, missing: 1, excused: 1 })
    expect(s.averagePoints).toBeCloseTo(10, 6)
    expect(s.averagePercent).toBeCloseTo(50, 6)
  })
  it('is null with nothing counted, and percent is null for a 0-point assignment', () => {
    expect(assignmentStats(a, [undefined, S(null)])).toMatchObject({
      counted: 0,
      averagePoints: null,
      averagePercent: null
    })
    expect(assignmentStats(A(2, 0), [S(3)]).averagePercent).toBeNull()
  })
})

describe('formatting', () => {
  it('rounds half up to one decimal and shows a dash for no grade', () => {
    expect(formatPercent(89.95)).toBe('90.0%')
    // These are the classic float traps: 8.35 is stored as 8.3499999999999996.
    expect(formatPercent(8.35)).toBe('8.4%')
    expect(formatPercent(0.05)).toBe('0.1%')
    expect(formatPercent(72.25)).toBe('72.3%')
    expect(formatPercent(100)).toBe('100.0%')
    expect(formatPercent(1234.56)).toBe('1234.6%')
    expect(formatPercent(76)).toBe('76.0%')
    expect(formatPercent(18.3333)).toBe('18.3%')
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
  })
  it('formats points without float noise', () => {
    expect(formatPoints(0.1 + 0.2)).toBe('0.3')
    expect(formatPoints(10)).toBe('10')
    expect(formatPoints(9.5)).toBe('9.5')
    expect(formatPoints(2.135)).toBe('2.14') // the previous EPSILON-based rounding gave 2.13
    expect(formatPoints(1.005)).toBe('1.01')
    expect(formatPoints(2.675)).toBe('2.68')
    expect(formatPoints(1e-7)).toBe('0')
    expect(formatPoints(null)).toBe('')
  })
})

describe('roundTo', () => {
  /** Exact half-up on the decimal text, using integers, as the reference. */
  const reference = (text: string, digits: number): number => {
    const [whole, frac = ''] = text.split('.')
    const padded = (frac + '0'.repeat(digits + 1)).slice(0, digits + 1)
    const scaled = BigInt(whole + padded.slice(0, digits)) + (padded[digits] >= '5' ? 1n : 0n)
    const s = scaled.toString().padStart(digits + 1, '0')
    return Number(`${s.slice(0, s.length - digits)}.${s.slice(s.length - digits)}`)
  }

  it('matches exact decimal half-up for every x.xx5 up to 200 (where binary rounding goes wrong)', () => {
    for (let k = 0; k < 200_000; k++) {
      const text = `${Math.floor(k / 1000)}.${String(k % 1000)
        .padStart(3, '0')
        .slice(0, 2)}5`
      expect(roundTo(Number(text), 2), text).toBe(reference(text, 2))
    }
  })

  it('handles zero, whole numbers, exponent notation and negatives sanely', () => {
    expect(roundTo(0, 1)).toBe(0)
    expect(roundTo(7, 2)).toBe(7)
    expect(roundTo(1e-9, 2)).toBe(0)
    expect(roundTo(1.5e21, 1)).toBe(1.5e21)
    expect(roundTo(-2.5, 0)).toBe(-2)
  })
})
