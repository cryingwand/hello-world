/**
 * Pure logic for the In-class Tools (timer, picker, groups, seating). Nothing here touches students,
 * the database or storage: the names are whatever the teacher typed or pasted, and they only ever
 * live in memory. Randomness and time are passed in so every rule can be tested.
 */

export type Random = () => number

export const MAX_NAMES = 200
export const MAX_NAME_LENGTH = 80

export interface ParsedNames {
  names: string[]
  /** Names left out because the list is longer than `MAX_NAMES`. */
  dropped: number
}

/**
 * One name per line. A list marker the teacher typed ("- ", "1. ") is dropped, and tabs between cells (a
 * row pasted from a spreadsheet) join into one name. Blank lines are ignored; repeated names are kept,
 * because two students can share one.
 */
export function parseNames(text: string): ParsedNames {
  const all: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const cells = line
      .replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '')
      .split('\t')
      .map((c) => c.trim())
      .filter((c) => c !== '')
    const name = cells.join(' ').replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH).trim()
    if (name !== '') all.push(name)
  }
  return { names: all.slice(0, MAX_NAMES), dropped: Math.max(0, all.length - MAX_NAMES) }
}

/** A shuffled copy (Fisher-Yates). The input is not changed. */
export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

// ---- Picker ------------------------------------------------------------------------------------

export interface PickerState {
  /** Who has not gone yet this round, as positions in the name list. */
  pool: number[]
  /** Who has gone this round, in order. */
  picked: number[]
  last: number | null
  /** 0 before the first pick. */
  round: number
}

export const newPicker = (): PickerState => ({ pool: [], picked: [], last: null, round: 0 })

/**
 * Picks one of `count` names. Without repeats everyone goes once before anyone goes again, and the
 * first pick of a new round is never the person who just went. With repeats every pick is a fresh draw.
 */
export function pickNext(
  state: PickerState,
  count: number,
  random: Random,
  allowRepeats = false
): PickerState {
  if (count <= 0) return state
  if (allowRepeats) {
    const i = Math.floor(random() * count)
    return { pool: [], picked: [...state.picked, i], last: i, round: Math.max(1, state.round) }
  }
  const fresh = state.pool.length === 0
  const pool = fresh ? range(count) : state.pool
  const candidates =
    fresh && count > 1 && state.last !== null ? pool.filter((i) => i !== state.last) : pool
  const chosen = candidates[Math.floor(random() * candidates.length)]
  return {
    pool: pool.filter((i) => i !== chosen),
    picked: fresh ? [chosen] : [...state.picked, chosen],
    last: chosen,
    round: fresh ? state.round + 1 : state.round
  }
}

// ---- Groups ------------------------------------------------------------------------------------

export type GroupSpec = { by: 'groups'; count: number } | { by: 'size'; size: number }

/** How many groups a spec makes for `n` names: at least one, never more than there are names. */
export function groupCount(n: number, spec: GroupSpec): number {
  if (n <= 0) return 0
  const raw = spec.by === 'groups' ? spec.count : Math.ceil(n / Math.max(1, spec.size))
  return Math.min(n, Math.max(1, Math.floor(Number.isFinite(raw) ? raw : 1)))
}

/**
 * Deals the names, shuffled, into groups whose sizes differ by at most one. "Groups of 4" with 10
 * names makes three groups (4, 3, 3), not two groups of four and one left over on their own.
 */
export function makeGroups(names: readonly string[], spec: GroupSpec, random: Random): string[][] {
  const k = groupCount(names.length, spec)
  if (k === 0) return []
  const order = shuffled(names, random)
  const base = Math.floor(order.length / k)
  const extra = order.length % k
  const groups: string[][] = []
  let at = 0
  for (let g = 0; g < k; g++) {
    const size = base + (g < extra ? 1 : 0)
    groups.push(order.slice(at, at + size))
    at += size
  }
  return groups
}

// ---- Seating -----------------------------------------------------------------------------------

// 15 x 15 holds the longest name list (MAX_NAMES) with room to spare.
export const MAX_SEAT_ROWS = 15
export const MAX_SEAT_COLS = 15

/** A chart is a list of seats read row by row; null is an empty desk. */
export type Seats = (string | null)[]

/** A roughly square grid that holds `n` names. */
export function suggestGrid(n: number): { rows: number; cols: number } {
  if (n <= 0) return { rows: 1, cols: 1 }
  const cols = Math.min(MAX_SEAT_COLS, Math.ceil(Math.sqrt(n)))
  return { rows: Math.min(MAX_SEAT_ROWS, Math.ceil(n / cols)), cols }
}

/** Everyone in a random seat, filling from the front and leaving any empty desks at the back. */
export function seatRandomly(
  names: readonly string[],
  rows: number,
  cols: number,
  random: Random
): Seats {
  const total = rows * cols
  if (names.length > total) {
    throw new RangeError(`${names.length} names do not fit in ${total} seats`)
  }
  return [...shuffled(names, random), ...Array<null>(total - names.length).fill(null)]
}

/** Swaps what is in two seats. Swapping with an empty desk moves the person there. */
export function swapSeats(seats: Seats, a: number, b: number): Seats {
  if (a === b || a < 0 || b < 0 || a >= seats.length || b >= seats.length) return seats
  const out = [...seats]
  ;[out[a], out[b]] = [out[b], out[a]]
  return out
}

/**
 * Changes the grid size and keeps each person where they sat (same row, same column). Anyone whose desk
 * is gone takes the first empty desk. Throws if the new grid cannot hold everyone.
 */
export function resizeSeats(seats: Seats, oldCols: number, rows: number, cols: number): Seats {
  const out: Seats = Array<null>(rows * cols).fill(null)
  const displaced: string[] = []
  seats.forEach((name, i) => {
    if (name === null) return
    const r = Math.floor(i / oldCols)
    const c = i % oldCols
    if (r < rows && c < cols) out[r * cols + c] = name
    else displaced.push(name)
  })
  for (const name of displaced) {
    const free = out.indexOf(null)
    if (free === -1) throw new RangeError('That grid is too small for everyone')
    out[free] = name
  }
  return out
}

// ---- Timer -------------------------------------------------------------------------------------

export const MAX_TIMER_MS = 24 * 60 * 60 * 1000

export interface TimerState {
  status: 'idle' | 'running' | 'paused' | 'done'
  /** What it was set to, so Reset can go back to it. */
  durationMs: number
  /** Time left when not running. While running, ask `timerRemaining`. */
  remainingMs: number
  /** When it reaches zero, while running. */
  endsAt: number | null
}

export const timerSet = (durationMs: number): TimerState => {
  const ms = Math.min(MAX_TIMER_MS, Math.max(0, Math.round(durationMs)))
  return { status: 'idle', durationMs: ms, remainingMs: ms, endsAt: null }
}

export function timerRemaining(state: TimerState, now: number): number {
  return state.status === 'running' && state.endsAt !== null
    ? Math.max(0, state.endsAt - now)
    : state.remainingMs
}

export function timerStart(state: TimerState, now: number): TimerState {
  if (state.status === 'running') return state
  const left = state.status === 'done' ? state.durationMs : state.remainingMs
  if (left <= 0) return state
  return { ...state, status: 'running', remainingMs: left, endsAt: now + left }
}

export function timerPause(state: TimerState, now: number): TimerState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', remainingMs: timerRemaining(state, now), endsAt: null }
}

/** Moves a running timer to done once its time is up. Call it as often as the display refreshes. */
export function timerTick(state: TimerState, now: number): TimerState {
  if (state.status !== 'running' || timerRemaining(state, now) > 0) return state
  return { ...state, status: 'done', remainingMs: 0, endsAt: null }
}

export const timerReset = (state: TimerState): TimerState => timerSet(state.durationMs)

/** Adds (or, if negative, takes off) time, from running, paused or idle. A finished timer starts over. */
export function timerAdd(state: TimerState, ms: number, now: number): TimerState {
  if (state.status === 'done') {
    return timerStart(timerSet(Math.max(0, ms)), now)
  }
  const left = Math.min(MAX_TIMER_MS, Math.max(0, timerRemaining(state, now) + ms))
  if (state.status === 'running') {
    return left === 0
      ? { ...state, status: 'done', remainingMs: 0, endsAt: null }
      : { ...state, remainingMs: left, endsAt: now + left }
  }
  return {
    ...state,
    remainingMs: left,
    durationMs: state.status === 'idle' ? left : state.durationMs
  }
}

/** "5:00", "0:07", "1:02:03". Rounds up to the next second, so 0:00 means it is actually over. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/**
 * What a teacher types into a timer: "10" (minutes), "1.5" (minutes), "5:30", "1:30:00", "90s", "2m",
 * "1h 15m". Null when it is not a time or is zero or more than a day.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase()
  if (t === '') return null
  let ms: number | null = null
  let m = /^(\d+):(\d{1,2})$/.exec(t)
  if (m) {
    if (Number(m[2]) > 59) return null
    ms = (Number(m[1]) * 60 + Number(m[2])) * 1000
  } else if ((m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(t))) {
    if (Number(m[2]) > 59 || Number(m[3]) > 59) return null
    ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
  } else if (/^\d+(?:\.\d+)?$/.test(t)) {
    ms = Math.round(Number(t) * 60 * 1000)
  } else if (/^(?:\d+(?:\.\d+)?\s*(?:h|m|s)\s*)+$/.test(t)) {
    ms = 0
    for (const [, n, unit] of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)) {
      ms += Number(n) * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1) * 1000
    }
    ms = Math.round(ms)
  }
  return ms !== null && ms >= 1000 && ms <= MAX_TIMER_MS ? ms : null
}
