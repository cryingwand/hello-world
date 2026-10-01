import { longDate } from './quiz'

/** Most lessons one unit may hold. */
export const MAX_LESSONS = 500

/** Lessons shown under "Coming up". */
export const UPCOMING_LIMIT = 30

/**
 * The non-blank lines of a typed block, trimmed. A list marker the teacher typed ("- ", "1. ") is
 * dropped, because the slide adds its own bullet and a typed one would show twice.
 */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '').trim())
    .filter((l) => l !== '')
}

/**
 * Splits bullets over as many slides as they need so none overflows. A slide holds `budget` lines
 * of text; a bullet longer than `perLine` characters wraps, so it counts as more than one. A single
 * bullet too long for a whole slide still gets a slide of its own, since it cannot be cut.
 */
export function chunkBullets(lines: string[], budget = 8, perLine = 70): string[][] {
  const slides: string[][] = []
  let current: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = Math.max(1, Math.ceil(line.length / perLine))
    if (current.length > 0 && used + cost > budget) {
      slides.push(current)
      current = []
      used = 0
    }
    current.push(line)
    used += cost
  }
  if (current.length > 0) slides.push(current)
  return slides
}

/** "October 2, 2026", or "October 2, 2026 – October 16, 2026" for a span, or "" when there is none. */
export function dateSpan(first: string | null, last: string | null): string {
  const a = longDate(first)
  const b = longDate(last)
  if (a === '' || b === '') return a || b
  return a === b ? a : `${a} – ${b}`
}

/** What a copy does with the dates on the lessons it makes. Clearing is the default: a copy is for later. */
export type CopyDates = { mode: 'keep' } | { mode: 'clear' } | { mode: 'shift'; days: number }

/** Furthest a copy may move its dates: about ten years either way. */
export const MAX_SHIFT_DAYS = 3660

/** A YYYY-MM-DD date moved by whole days, worked in UTC so a daylight-saving change can never move it. */
export function shiftDate(date: string | null, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  if (!m) return null
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  const p = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${p(t.getUTCFullYear(), 4)}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}

/** A copied lesson's date under the chosen rule. */
export function copiedDate(date: string | null, dates: CopyDates): string | null {
  if (dates.mode === 'keep') return date
  if (dates.mode === 'shift') return shiftDate(date, dates.days)
  return null
}

/** "Day 1" -> "Day 1 (copy)", cut so the result still fits in `max` characters. */
export function copyTitle(title: string, max = 200): string {
  const suffix = ' (copy)'
  return title.length + suffix.length <= max
    ? title + suffix
    : title.slice(0, max - suffix.length).trimEnd() + suffix
}
