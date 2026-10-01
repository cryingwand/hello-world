import { describe, expect, it } from 'vitest'
import {
  MAX_NAMES,
  MAX_NAME_LENGTH,
  MAX_TIMER_MS,
  formatClock,
  groupCount,
  makeGroups,
  newPicker,
  parseDuration,
  parseNames,
  pickNext,
  resizeSeats,
  seatRandomly,
  shuffled,
  suggestGrid,
  swapSeats,
  timerAdd,
  timerPause,
  timerRemaining,
  timerReset,
  timerSet,
  timerStart,
  timerTick,
  type Random
} from '@shared/tools'

/** A small seeded generator, so a test that uses chance is the same every run. */
function seeded(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `N${i + 1}`)

describe('parseNames', () => {
  it('reads one name per line and ignores blanks', () => {
    expect(parseNames('Ada\n\n  Grace Hopper  \r\nAlan').names).toEqual([
      'Ada',
      'Grace Hopper',
      'Alan'
    ])
  })
  it('drops typed list markers', () => {
    expect(parseNames('- Ada\n* Grace\n• Alan\n1. Katherine\n2) Mary\n10. Dorothy').names).toEqual([
      'Ada',
      'Grace',
      'Alan',
      'Katherine',
      'Mary',
      'Dorothy'
    ])
  })
  it('joins the cells of a pasted spreadsheet row into one name', () => {
    expect(parseNames('Ada\tLovelace\nGrace\t\tHopper').names).toEqual([
      'Ada Lovelace',
      'Grace Hopper'
    ])
  })
  it('keeps repeated names, because two students can share one', () => {
    expect(parseNames('Sam\nSam').names).toEqual(['Sam', 'Sam'])
  })
  it('collapses inner spaces and cuts a very long name', () => {
    expect(parseNames('Ada    Lovelace').names).toEqual(['Ada Lovelace'])
    expect(parseNames('x'.repeat(500)).names[0]).toHaveLength(MAX_NAME_LENGTH)
  })
  it('keeps the first MAX_NAMES and says how many it dropped', () => {
    const r = parseNames(names(MAX_NAMES + 7).join('\n'))
    expect(r.names).toHaveLength(MAX_NAMES)
    expect(r.names[0]).toBe('N1')
    expect(r.dropped).toBe(7)
    expect(parseNames('Ada').dropped).toBe(0)
  })
  it('gives nothing for empty text', () => {
    expect(parseNames('')).toEqual({ names: [], dropped: 0 })
    expect(parseNames(' \n\t\n')).toEqual({ names: [], dropped: 0 })
  })
})

describe('shuffled', () => {
  it('keeps every item, does not change its input, and is repeatable for one seed', () => {
    const input = names(20)
    const out = shuffled(input, seeded(1))
    expect([...out].sort()).toEqual([...input].sort())
    expect(input).toEqual(names(20))
    expect(out).toEqual(shuffled(input, seeded(1)))
    expect(out).not.toEqual(input)
  })
  it('can put any item in any place (no position is ever ruled out)', () => {
    const seen = Array.from({ length: 4 }, () => new Set<string>())
    for (let s = 1; s <= 400; s++)
      shuffled(['a', 'b', 'c', 'd'], seeded(s)).forEach((x, i) => seen[i].add(x))
    for (const set of seen) expect(set.size).toBe(4)
  })
  it('handles empty and single lists', () => {
    expect(shuffled([], seeded(1))).toEqual([])
    expect(shuffled(['a'], seeded(1))).toEqual(['a'])
  })
})

describe('picker', () => {
  it('goes through everyone once before anyone goes again', () => {
    const random = seeded(7)
    let s = newPicker()
    const round1: number[] = []
    for (let i = 0; i < 6; i++) {
      s = pickNext(s, 6, random)
      round1.push(s.last!)
    }
    expect([...round1].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(s.round).toBe(1)
    expect(s.pool).toEqual([])
    s = pickNext(s, 6, random)
    expect(s.round).toBe(2)
    expect(s.picked).toEqual([s.last])
    expect(s.pool).toHaveLength(5)
  })

  it('never opens a new round with the person who just went', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seeded(seed)
      let s = newPicker()
      for (let i = 0; i < 3; i++) s = pickNext(s, 3, random)
      const justWent = s.last
      s = pickNext(s, 3, random)
      expect(s.last).not.toBe(justWent)
    }
  })

  it('with one name, picks that name every time', () => {
    let s = newPicker()
    for (let i = 0; i < 3; i++) {
      s = pickNext(s, 1, seeded(1))
      expect(s.last).toBe(0)
    }
  })

  it('gives every position the same chance (a rough check over many rounds)', () => {
    const counts = [0, 0, 0, 0, 0]
    const random = seeded(99)
    let s = newPicker()
    s = pickNext(s, 5, random)
    for (let i = 0; i < 4999; i++) {
      counts[s.last!]++
      s = pickNext(s, 5, random)
    }
    for (const c of counts) expect(c).toBeGreaterThan(900)
  })

  it('with repeats allowed, every draw is independent and the round does not reset', () => {
    let s = newPicker()
    const lasts = new Set<number>()
    for (let i = 0; i < 60; i++) {
      s = pickNext(s, 3, seeded(i + 1), true)
      lasts.add(s.last!)
    }
    expect(lasts).toEqual(new Set([0, 1, 2]))
    expect(s.pool).toEqual([])
    expect(s.round).toBe(1)
  })

  it('does nothing with no names', () => {
    const s = newPicker()
    expect(pickNext(s, 0, seeded(1))).toBe(s)
  })
})

describe('groups', () => {
  it('splits into the number of groups asked for, sizes differing by at most one', () => {
    for (const [n, k] of [
      [10, 3],
      [10, 4],
      [7, 7],
      [13, 5],
      [30, 6]
    ]) {
      const groups = makeGroups(names(n), { by: 'groups', count: k }, seeded(n))
      expect(groups).toHaveLength(k)
      const sizes = groups.map((g) => g.length)
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n)
    }
  })

  it('"groups of N" never makes a group bigger than N and evens out the leftovers', () => {
    const groups = makeGroups(names(10), { by: 'size', size: 4 }, seeded(1))
    expect(groups.map((g) => g.length)).toEqual([4, 3, 3])
    expect(makeGroups(names(9), { by: 'size', size: 4 }, seeded(1)).map((g) => g.length)).toEqual([
      3, 3, 3
    ])
    for (let n = 1; n <= 40; n++) {
      for (let size = 1; size <= 8; size++) {
        const g = makeGroups(names(n), { by: 'size', size }, seeded(n * 31 + size))
        expect(Math.max(...g.map((x) => x.length))).toBeLessThanOrEqual(size)
        expect(g.flat()).toHaveLength(n)
      }
    }
  })

  it('uses everyone exactly once', () => {
    const groups = makeGroups(names(17), { by: 'groups', count: 4 }, seeded(3))
    expect([...groups.flat()].sort()).toEqual([...names(17)].sort())
  })

  it('does not change the list it was given, and is repeatable for one seed', () => {
    const input = names(12)
    const a = makeGroups(input, { by: 'groups', count: 3 }, seeded(5))
    expect(input).toEqual(names(12))
    expect(a).toEqual(makeGroups(input, { by: 'groups', count: 3 }, seeded(5)))
    expect(a).not.toEqual(makeGroups(input, { by: 'groups', count: 3 }, seeded(6)))
  })

  it('keeps asking for more groups than names, or fewer than one, sensible', () => {
    expect(groupCount(5, { by: 'groups', count: 99 })).toBe(5)
    expect(groupCount(5, { by: 'groups', count: 0 })).toBe(1)
    expect(groupCount(5, { by: 'groups', count: -3 })).toBe(1)
    expect(groupCount(5, { by: 'groups', count: 2.9 })).toBe(2)
    expect(groupCount(5, { by: 'groups', count: Number.NaN })).toBe(1)
    expect(groupCount(5, { by: 'size', size: 0 })).toBe(5)
    expect(groupCount(0, { by: 'groups', count: 3 })).toBe(0)
    expect(makeGroups([], { by: 'groups', count: 3 }, seeded(1))).toEqual([])
    expect(makeGroups(['a'], { by: 'groups', count: 3 }, seeded(1))).toEqual([['a']])
  })
})

describe('seating', () => {
  it('suggests a roughly square grid that holds everyone', () => {
    for (let n = 1; n <= 144; n++) {
      const { rows, cols } = suggestGrid(n)
      expect(rows * cols).toBeGreaterThanOrEqual(n)
      expect(rows * cols - n).toBeLessThan(cols)
    }
    expect(suggestGrid(0)).toEqual({ rows: 1, cols: 1 })
    expect(suggestGrid(25)).toEqual({ rows: 5, cols: 5 })
  })

  it('seats everyone once, fills from the front and leaves empty desks at the back', () => {
    const seats = seatRandomly(names(7), 3, 3, seeded(2))
    expect(seats).toHaveLength(9)
    expect([...seats.filter((s) => s !== null)].sort()).toEqual([...names(7)].sort())
    expect(seats.slice(7)).toEqual([null, null])
  })

  it('refuses to seat more people than there are desks', () => {
    expect(() => seatRandomly(names(10), 3, 3, seeded(1))).toThrow(RangeError)
  })

  it('swaps two seats, moves a person to an empty desk, and ignores nonsense', () => {
    const seats = ['a', 'b', null, 'd']
    expect(swapSeats(seats, 0, 1)).toEqual(['b', 'a', null, 'd'])
    expect(swapSeats(seats, 0, 2)).toEqual([null, 'b', 'a', 'd'])
    expect(swapSeats(seats, 1, 1)).toBe(seats)
    expect(swapSeats(seats, -1, 2)).toBe(seats)
    expect(swapSeats(seats, 0, 9)).toBe(seats)
    expect(seats).toEqual(['a', 'b', null, 'd'])
  })

  it('keeps people in the same row and column when the grid grows', () => {
    // 2 x 2:  a b / c d   ->   2 x 3:  a b . / c d .
    expect(resizeSeats(['a', 'b', 'c', 'd'], 2, 2, 3)).toEqual(['a', 'b', null, 'c', 'd', null])
    // and a taller grid
    expect(resizeSeats(['a', 'b', 'c', 'd'], 2, 3, 2)).toEqual(['a', 'b', 'c', 'd', null, null])
  })

  it('moves people whose desk disappears into empty desks, losing no one', () => {
    // 2 x 3:  a b c / d e f  -> 2 x 2: a b / d e, then c and f take the free desks (none free).
    expect(() => resizeSeats(['a', 'b', 'c', 'd', 'e', 'f'], 3, 2, 2)).toThrow(RangeError)
    // 2 x 3 with gaps:  a . c / d . f  -> 2 x 2: a . / d . then c, f fill the gaps
    expect(resizeSeats(['a', null, 'c', 'd', null, 'f'], 3, 2, 2)).toEqual(['a', 'c', 'd', 'f'])
  })

  it('never loses or duplicates anyone across many random resizes', () => {
    const random = seeded(11)
    let seats = seatRandomly(names(20), 5, 5, random)
    let cols = 5
    for (let i = 0; i < 200; i++) {
      const rows = 4 + Math.floor(random() * 6)
      const next = 4 + Math.floor(random() * 6)
      if (rows * next < 20) continue
      seats = resizeSeats(seats, cols, rows, next)
      cols = next
      expect([...seats.filter((s) => s !== null)].sort()).toEqual([...names(20)].sort())
    }
  })
})

describe('timer', () => {
  const T0 = 1_000_000

  it('starts, counts down from a clock, and finishes', () => {
    let t = timerSet(5000)
    expect(t).toMatchObject({ status: 'idle', remainingMs: 5000 })
    t = timerStart(t, T0)
    expect(t.status).toBe('running')
    expect(timerRemaining(t, T0 + 1500)).toBe(3500)
    expect(timerTick(t, T0 + 4999).status).toBe('running')
    const done = timerTick(t, T0 + 5000)
    expect(done).toMatchObject({ status: 'done', remainingMs: 0, endsAt: null })
    expect(timerRemaining(done, T0 + 99999)).toBe(0)
  })

  it('stays right however late it is checked (a stalled screen does not lose time)', () => {
    const t = timerStart(timerSet(60_000), T0)
    expect(timerRemaining(t, T0 + 59_000)).toBe(1000)
    expect(timerRemaining(t, T0 + 300_000)).toBe(0)
    expect(timerTick(t, T0 + 300_000).status).toBe('done')
  })

  it('pauses and resumes without gaining or losing time', () => {
    let t = timerStart(timerSet(10_000), T0)
    t = timerPause(t, T0 + 4000)
    expect(t).toMatchObject({ status: 'paused', remainingMs: 6000, endsAt: null })
    expect(timerRemaining(t, T0 + 50_000)).toBe(6000)
    t = timerStart(t, T0 + 50_000)
    expect(timerRemaining(t, T0 + 52_000)).toBe(4000)
  })

  it('resets to what it was set to, and a finished timer starts again from the full time', () => {
    let t = timerStart(timerSet(3000), T0)
    t = timerTick(t, T0 + 3000)
    expect(timerReset(t)).toMatchObject({ status: 'idle', remainingMs: 3000 })
    const again = timerStart(t, T0 + 9000)
    expect(again.status).toBe('running')
    expect(timerRemaining(again, T0 + 9000)).toBe(3000)
  })

  it('cannot start at zero, and ignores pause and start in the wrong state', () => {
    const zero = timerSet(0)
    expect(timerStart(zero, T0)).toBe(zero)
    const idle = timerSet(1000)
    expect(timerPause(idle, T0)).toBe(idle)
    const running = timerStart(idle, T0)
    expect(timerStart(running, T0 + 500)).toBe(running)
    expect(timerTick(idle, T0 + 99999)).toBe(idle)
  })

  it('adds time to a running timer, a paused one and an idle one', () => {
    let t = timerStart(timerSet(10_000), T0)
    t = timerAdd(t, 60_000, T0 + 4000)
    expect(timerRemaining(t, T0 + 4000)).toBe(66_000)
    expect(t.status).toBe('running')

    let p = timerPause(timerStart(timerSet(10_000), T0), T0 + 2000)
    p = timerAdd(p, 5000, T0 + 9000)
    expect(p).toMatchObject({ status: 'paused', remainingMs: 13_000 })

    const idle = timerAdd(timerSet(60_000), 60_000, T0)
    expect(idle).toMatchObject({ status: 'idle', remainingMs: 120_000, durationMs: 120_000 })
  })

  it('takes time off, down to zero and no further (which finishes a running timer)', () => {
    const running = timerStart(timerSet(10_000), T0)
    expect(timerRemaining(timerAdd(running, -4000, T0 + 1000), T0 + 1000)).toBe(5000)
    expect(timerAdd(running, -99_000, T0 + 1000)).toMatchObject({ status: 'done', remainingMs: 0 })
    expect(timerAdd(timerSet(5000), -99_000, T0).remainingMs).toBe(0)
  })

  it('adding to a finished timer starts it again with that time', () => {
    const done = timerTick(timerStart(timerSet(1000), T0), T0 + 1000)
    const again = timerAdd(done, 60_000, T0 + 2000)
    expect(again.status).toBe('running')
    expect(timerRemaining(again, T0 + 2000)).toBe(60_000)
  })

  it('is capped at a day', () => {
    expect(timerSet(Number.MAX_SAFE_INTEGER).durationMs).toBe(MAX_TIMER_MS)
    expect(timerAdd(timerSet(MAX_TIMER_MS), 1000, T0).remainingMs).toBe(MAX_TIMER_MS)
    expect(timerSet(-5).durationMs).toBe(0)
  })
})

describe('formatClock', () => {
  it('shows minutes and seconds, and hours when there are any', () => {
    expect(formatClock(300_000)).toBe('5:00')
    expect(formatClock(7000)).toBe('0:07')
    expect(formatClock(3_723_000)).toBe('1:02:03')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(-50)).toBe('0:00')
  })
  it('rounds up so 0:00 only shows when it is really over', () => {
    expect(formatClock(1)).toBe('0:01')
    expect(formatClock(999)).toBe('0:01')
    expect(formatClock(1001)).toBe('0:02')
    expect(formatClock(59_001)).toBe('1:00')
  })
})

describe('parseDuration', () => {
  it('reads a plain number as minutes, decimals included', () => {
    expect(parseDuration('10')).toBe(600_000)
    expect(parseDuration('1.5')).toBe(90_000)
    expect(parseDuration(' 7 ')).toBe(420_000)
  })
  it('reads m:ss and h:mm:ss', () => {
    expect(parseDuration('5:30')).toBe(330_000)
    expect(parseDuration('0:45')).toBe(45_000)
    expect(parseDuration('1:30:00')).toBe(5_400_000)
  })
  it('reads units, in any combination and in any case', () => {
    expect(parseDuration('90s')).toBe(90_000)
    expect(parseDuration('2m')).toBe(120_000)
    expect(parseDuration('1h')).toBe(3_600_000)
    expect(parseDuration('1h 15m')).toBe(4_500_000)
    expect(parseDuration('1H15M30S')).toBe(4_530_000)
    expect(parseDuration('1.5m')).toBe(90_000)
  })
  it('refuses what is not a time, zero, too short and more than a day', () => {
    for (const bad of [
      '',
      '  ',
      'soon',
      '0',
      '0:00',
      '0s',
      '5:75',
      '1:99:00',
      '25h',
      '2000',
      '-5',
      '5 minutes',
      '1:2:3:4'
    ]) {
      expect(parseDuration(bad), bad).toBeNull()
    }
    expect(parseDuration('24h')).toBe(MAX_TIMER_MS)
    expect(parseDuration('0.01')).toBeNull() // under a second
  })
})
