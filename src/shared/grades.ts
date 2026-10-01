import type { GradingMode, ScoreStatus } from './models'

/**
 * Grade rules (kept in one place so the grid, the student view and exports always agree):
 *
 * - No score, or a score with no points and no flag: ungraded. Not counted at all.
 * - `excused`: not counted at all, as if the assignment did not exist for that student.
 * - `missing`: counts as zero points earned out of the assignment's points possible.
 *   The flag wins over any points that may also be stored.
 * - `late`: only a flag. The points count exactly as entered (a late penalty is applied by typing
 *   the reduced score). A late score with no points is ungraded.
 * - Points can exceed points possible (extra credit).
 *
 * Points mode: percent = total points earned / total points possible, across every counted score.
 *
 * Weighted mode: each category's percent = its points earned / points possible. The overall grade
 * is the weighted average of those category percents, using only categories that have counted work
 * and a weight above zero (their weights are rescaled to add up), the usual gradebook behaviour
 * while a term is in progress. Assignments with no category are ignored in weighted mode.
 */

export interface ScoreLike {
  points: number | null
  status: ScoreStatus | null
}

export interface AssignmentLike {
  id: number
  categoryId: number | null
  pointsPossible: number
}

export interface CategoryLike {
  id: number
  name: string
  weight: number
}

export interface Contribution {
  earned: number
  possible: number
}

/** What one score adds to a grade, or null when it is not counted. */
export function contribution(score: ScoreLike | undefined, a: AssignmentLike): Contribution | null {
  if (!score || score.status === 'excused') return null
  if (score.status === 'missing') return { earned: 0, possible: a.pointsPossible }
  if (score.points === null) return null
  return { earned: score.points, possible: a.pointsPossible }
}

export interface CategoryGrade {
  categoryId: number
  name: string
  weight: number
  earned: number
  possible: number
  /** Null when nothing in the category has been graded. */
  percent: number | null
  counted: number
}

export interface GradeCounts {
  total: number
  graded: number
  missing: number
  excused: number
  late: number
  ungraded: number
}

export interface StudentGrade {
  /** Null when there is nothing to grade yet. */
  percent: number | null
  earned: number
  possible: number
  categories: CategoryGrade[]
  counts: GradeCounts
  /** Weighted mode only: assignments ignored because they have no category. */
  uncategorized: number
}

export function computeStudentGrade(
  mode: GradingMode,
  assignments: readonly AssignmentLike[],
  categories: readonly CategoryLike[],
  scores: ReadonlyMap<number, ScoreLike>
): StudentGrade {
  const counts: GradeCounts = {
    total: assignments.length,
    graded: 0,
    missing: 0,
    excused: 0,
    late: 0,
    ungraded: 0
  }
  const perCategory = new Map<number, CategoryGrade>(
    categories.map((c) => [
      c.id,
      {
        categoryId: c.id,
        name: c.name,
        weight: c.weight,
        earned: 0,
        possible: 0,
        percent: null,
        counted: 0
      }
    ])
  )
  let earned = 0
  let possible = 0
  let uncategorized = 0

  for (const a of assignments) {
    const s = scores.get(a.id)
    if (s?.status === 'missing') counts.missing++
    if (s?.status === 'excused') counts.excused++
    if (s?.status === 'late') counts.late++
    const c = contribution(s, a)
    if (!c) {
      if (s?.status !== 'excused') counts.ungraded++
      continue
    }
    if (s?.status !== 'missing') counts.graded++

    const cat = a.categoryId === null ? undefined : perCategory.get(a.categoryId)
    if (mode === 'weighted') {
      if (!cat) {
        uncategorized++
        continue
      }
      cat.earned += c.earned
      cat.possible += c.possible
      cat.counted++
      earned += c.earned
      possible += c.possible
    } else {
      if (cat) {
        cat.earned += c.earned
        cat.possible += c.possible
        cat.counted++
      }
      earned += c.earned
      possible += c.possible
    }
  }

  const cats = [...perCategory.values()]
  for (const c of cats) c.percent = c.possible > 0 ? (c.earned / c.possible) * 100 : null

  let percent: number | null
  if (mode === 'points') {
    percent = possible > 0 ? (earned / possible) * 100 : null
  } else {
    let weighted = 0
    let weightUsed = 0
    for (const c of cats) {
      if (c.percent !== null && c.weight > 0) {
        weighted += c.weight * c.percent
        weightUsed += c.weight
      }
    }
    percent = weightUsed > 0 ? weighted / weightUsed : null
  }
  return { percent, earned, possible, categories: cats, counts, uncategorized }
}

/** Mean of the students who have a grade; null if none do. */
export function classAverage(percents: readonly (number | null)[]): number | null {
  const real = percents.filter((p): p is number => p !== null)
  return real.length === 0 ? null : real.reduce((a, b) => a + b, 0) / real.length
}

export interface AssignmentStats {
  /** Scores that count (graded or missing). */
  counted: number
  missing: number
  excused: number
  averagePoints: number | null
  /** Mean of each counted score as a percent of points possible; null if points possible is 0. */
  averagePercent: number | null
}

export function assignmentStats(
  a: AssignmentLike,
  scores: readonly (ScoreLike | undefined)[]
): AssignmentStats {
  let counted = 0
  let missing = 0
  let excused = 0
  let pointsSum = 0
  for (const s of scores) {
    if (s?.status === 'missing') missing++
    if (s?.status === 'excused') excused++
    const c = contribution(s, a)
    if (!c) continue
    counted++
    pointsSum += c.earned
  }
  return {
    counted,
    missing,
    excused,
    averagePoints: counted > 0 ? pointsSum / counted : null,
    averagePercent:
      counted > 0 && a.pointsPossible > 0 ? (pointsSum / counted / a.pointsPossible) * 100 : null
  }
}

/**
 * Rounds half up in decimal, not in binary: 8.35 is stored as 8.3499999999999996 and must still
 * give 8.4. Shifting the decimal point through the number's shortest text form avoids the trap.
 */
export function roundTo(n: number, digits: number): number {
  const text = String(n)
  if (/e/i.test(text)) return Math.round(n * 10 ** digits) / 10 ** digits // tiny or huge: no trap here
  const shifted = Math.round(Number(`${text}e${digits}`))
  return Number(`${shifted}e${-digits}`)
}

/** One decimal place for display. */
export function round1(n: number): number {
  return roundTo(n, 1)
}

export function formatPercent(p: number | null | undefined): string {
  return p === null || p === undefined || !Number.isFinite(p) ? '—' : `${round1(p).toFixed(1)}%`
}

/** Points without float noise or trailing zeros: 9.5, 10, 0.3. */
export function formatPoints(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  return String(roundTo(n, 2))
}
