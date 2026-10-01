import { guessMapping, splitFullName } from './roster'
import { computeStudentGrade, formatPoints, round1 } from './grades'
import type { Assignment, GradeCategory, GradingMode, Score, ScoreStatus, Student } from './models'

/** One spreadsheet column that holds scores for a single assignment. */
export interface ScoreColumn {
  index: number
  title: string
  pointsPossible: number
  /** Only used when this column creates a new assignment. */
  categoryId: number | null
}

export interface ScoreImportMapping {
  firstName: number | null
  lastName: number | null
  fullName: number | null
  email: number | null
  columns: ScoreColumn[]
}

export interface ScoreImportRequest {
  token: string
  sheet?: string | null
  hasHeader: boolean
  /** The row under the header lists each assignment's points possible. */
  pointsRow: boolean
  classId: number
  mapping: ScoreImportMapping
}

export interface ScoreImportResult {
  createdAssignments: number
  scoresWritten: number
  unchanged: number
  /** Rows whose student could not be matched to this class. */
  skippedRows: number
  invalidCells: number
}

export type ParsedCell =
  | { kind: 'blank' }
  | { kind: 'points'; points: number }
  | { kind: 'status'; status: ScoreStatus }
  | { kind: 'invalid'; text: string }

/** Reads one spreadsheet cell: a number, M (missing), EX (excused), or blank. */
export function parseScoreCell(raw: string | undefined): ParsedCell {
  const t = (raw ?? '').trim()
  if (t === '' || /^(-|—|–|n\/a|na)$/i.test(t)) return { kind: 'blank' }
  if (/^(m|miss|missing)$/i.test(t)) return { kind: 'status', status: 'missing' }
  if (/^(ex|exc|excused)$/i.test(t)) return { kind: 'status', status: 'excused' }
  if (/^\d+([.,]\d+)?$|^\.\d+$/.test(t)) {
    const n = Number(t.replace(',', '.'))
    if (Number.isFinite(n)) return { kind: 'points', points: n }
  }
  return { kind: 'invalid', text: t }
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const POINTS_IN_TITLE: RegExp[] = [
  new RegExp(String.raw`^(.*?)\s*[(\[]\s*${NUM}\s*(?:pts?|points?)?\s*[)\]]\s*$`, 'i'), // Quiz 1 (20)  Essay [50 pts]
  new RegExp(String.raw`^(.*?)\s*/\s*${NUM}\s*(?:pts?|points?)?\s*$`, 'i'), // HW 1 /10
  new RegExp(String.raw`^(.*?)\s+[-–—]\s+${NUM}\s*(?:pts?|points?)\s*$`, 'i') // Quiz - 20 pts
]

/** Splits "Quiz 1 (20)" into a title and points possible when the header carries the points. */
export function parseColumnHeader(header: string): { title: string; points: number | null } {
  const h = header.trim().replace(/\s+/g, ' ')
  for (const re of POINTS_IN_TITLE) {
    const m = re.exec(h)
    if (m && m[1].trim()) return { title: m[1].trim(), points: Number(m[2].replace(',', '.')) }
  }
  return { title: h, points: null }
}

/** Columns that are about the student or a summary, never an assignment. */
const NOT_AN_ASSIGNMENT =
  /^(student )?(id|number|no|#)$|\bid\b|^(grade|grade level|year|homeroom|section|period|advisor|advisory|teacher|gender|sex|dob|birthday|course|class|status|notes?|comments?)$|\b(total|average|avg|overall|final|current|running|percent|percentage|gpa|letter)\b|%/i

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export interface DetectedColumns {
  mapping: ScoreImportMapping
  /** Human-readable notes about what was skipped or guessed. */
  notes: string[]
}

/**
 * Guesses which columns identify the student and which hold assignment scores. A column counts as
 * scores when its header is not a known non-score/summary label and most of its filled cells look
 * like scores (numbers, M or EX).
 */
export function detectScoreColumns(
  rows: string[][],
  hasHeader: boolean,
  pointsRow: boolean
): DetectedColumns {
  const header = hasHeader ? (rows[0] ?? []) : []
  const ident = guessMapping(header)
  const idCols = new Set(
    [ident.firstName, ident.lastName, ident.fullName, ident.email].filter(
      (i): i is number => i !== null
    )
  )
  const dataStart = (hasHeader ? 1 : 0) + (hasHeader && pointsRow ? 1 : 0)
  const data = rows.slice(dataStart)
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length))
  const pts = hasHeader && pointsRow ? (rows[1] ?? []) : []
  const notes: string[] = []
  const columns: ScoreColumn[] = []

  for (let i = 0; i < width; i++) {
    if (idCols.has(i)) continue
    const rawHeader = header[i] ?? ''
    if (hasHeader && rawHeader.trim() === '') continue
    if (hasHeader && NOT_AN_ASSIGNMENT.test(norm(rawHeader))) {
      notes.push(`Skipped "${rawHeader}" (looks like a summary or student detail)`)
      continue
    }
    const cells = data.map((r) => (r[i] ?? '').trim()).filter((c) => c !== '')
    if (cells.length === 0) continue
    const scoreLike = cells.filter((c) => parseScoreCell(c).kind !== 'invalid').length
    if (scoreLike / cells.length < 0.5) {
      notes.push(`Skipped "${rawHeader || `column ${i + 1}`}" (mostly not scores)`)
      continue
    }
    const parsed = parseColumnHeader(rawHeader || `Column ${i + 1}`)
    const fromRow = pointsRow ? parseScoreCell(pts[i]) : null
    const pointsPossible = fromRow?.kind === 'points' ? fromRow.points : (parsed.points ?? 0)
    columns.push({ index: i, title: parsed.title, pointsPossible, categoryId: null })
  }
  return {
    mapping: {
      firstName: ident.firstName,
      lastName: ident.lastName,
      fullName: ident.fullName,
      email: ident.email,
      columns
    },
    notes
  }
}

export interface ScoreChange {
  rowNumber: number
  studentId: number
  /** Index into `mapping.columns`. */
  column: number
  assignmentId: number | null
  points: number | null
  status: ScoreStatus | null
  /** True when the stored score already matches, so nothing will be written. */
  unchanged: boolean
}

export interface ScoreProblem {
  rowNumber: number
  message: string
}

export interface ScoreImportPlan {
  /** One entry per data row, in file order. */
  rows: { rowNumber: number; label: string; studentId: number | null }[]
  assignments: {
    column: number
    title: string
    pointsPossible: number
    existingId: number | null
  }[]
  changes: ScoreChange[]
  problems: ScoreProblem[]
  counts: {
    rows: number
    matchedStudents: number
    unmatchedStudents: number
    newAssignments: number
    existingAssignments: number
    scoresToWrite: number
    unchanged: number
    invalidCells: number
  }
}

const nameKey = (first: string, last: string): string => `${norm(first)}|${norm(last)}`
const cellAt = (row: string[], i: number | null): string =>
  i === null ? '' : (row[i] ?? '').trim()

/**
 * Decides, without writing anything, what a score import would do. Students are matched to this
 * class's roster by email, then by name. Columns are matched to existing assignments by title
 * (ignoring case); the rest become new assignments. Blank cells never erase a stored score.
 */
export function planScoreImport(
  rows: string[][],
  hasHeader: boolean,
  pointsRow: boolean,
  mapping: ScoreImportMapping,
  roster: readonly Student[],
  assignments: readonly Assignment[],
  scores: readonly Score[]
): ScoreImportPlan {
  const byEmail = new Map<string, Student>()
  const byName = new Map<string, Student[]>()
  for (const s of roster) {
    if (s.email) byEmail.set(s.email.toLowerCase(), s)
    const k = nameKey(s.firstName, s.lastName)
    byName.set(k, [...(byName.get(k) ?? []), s])
  }
  const byTitle = new Map(assignments.map((a) => [norm(a.title), a]))
  const existing = new Map(scores.map((s) => [`${s.assignmentId}:${s.studentId}`, s]))

  const plan: ScoreImportPlan = {
    rows: [],
    assignments: mapping.columns.map((c, i) => ({
      column: i,
      title: c.title,
      pointsPossible: c.pointsPossible,
      existingId: byTitle.get(norm(c.title))?.id ?? null
    })),
    changes: [],
    problems: [],
    counts: {
      rows: 0,
      matchedStudents: 0,
      unmatchedStudents: 0,
      newAssignments: 0,
      existingAssignments: 0,
      scoresToWrite: 0,
      unchanged: 0,
      invalidCells: 0
    }
  }
  plan.counts.newAssignments = plan.assignments.filter((a) => a.existingId === null).length
  plan.counts.existingAssignments = plan.assignments.length - plan.counts.newAssignments

  const start = (hasHeader ? 1 : 0) + (hasHeader && pointsRow ? 1 : 0)
  rows.forEach((row, i) => {
    if (i < start || row.every((c) => !c.trim())) return
    const rowNumber = i + 1
    let first = cellAt(row, mapping.firstName)
    let last = cellAt(row, mapping.lastName)
    if (!first && !last && mapping.fullName !== null)
      ({ first, last } = splitFullName(cellAt(row, mapping.fullName)))
    const email = cellAt(row, mapping.email).toLowerCase()
    const label = [last, first].filter(Boolean).join(', ') || email || `Row ${rowNumber}`
    plan.counts.rows++

    let student: Student | undefined = email ? byEmail.get(email) : undefined
    if (!student && (first || last)) {
      const candidates = byName.get(nameKey(first, last)) ?? []
      if (candidates.length > 1) {
        plan.problems.push({
          rowNumber,
          message: `${label}: more than one student in this class has that name. Add an email column to tell them apart.`
        })
        plan.rows.push({ rowNumber, label, studentId: null })
        plan.counts.unmatchedStudents++
        return
      }
      student = candidates[0]
    }
    if (!student) {
      plan.problems.push({
        rowNumber,
        message: `${label}: no student with that name or email in this class`
      })
      plan.rows.push({ rowNumber, label, studentId: null })
      plan.counts.unmatchedStudents++
      return
    }
    plan.rows.push({ rowNumber, label, studentId: student.id })
    plan.counts.matchedStudents++

    mapping.columns.forEach((col, ci) => {
      const cell = parseScoreCell(row[col.index])
      if (cell.kind === 'blank') return
      if (cell.kind === 'invalid') {
        plan.counts.invalidCells++
        plan.problems.push({
          rowNumber,
          message: `${label}, ${col.title}: "${cell.text}" is not a score. Use a number, M (missing) or EX (excused).`
        })
        return
      }
      const assignmentId = plan.assignments[ci].existingId
      const prev = assignmentId === null ? undefined : existing.get(`${assignmentId}:${student.id}`)
      let points: number | null
      let status: ScoreStatus | null
      if (cell.kind === 'points') {
        points = cell.points
        // A late flag survives a re-import of the number; missing and excused do not.
        status = prev?.status === 'late' ? 'late' : null
      } else {
        points = null
        status = cell.status
      }
      const unchanged = !!prev && prev.points === points && prev.status === status
      if (unchanged) plan.counts.unchanged++
      else plan.counts.scoresToWrite++
      plan.changes.push({
        rowNumber,
        studentId: student.id,
        column: ci,
        assignmentId,
        points,
        status,
        unchanged
      })
    })
  })
  return plan
}

/** Rows for a gradebook export: names, one column per assignment, and each student's average. */
export function scoreExportRows(
  mode: GradingMode,
  students: readonly Student[],
  assignments: readonly Assignment[],
  categories: readonly GradeCategory[],
  scores: readonly Score[]
): (string | number)[][] {
  const bySA = new Map(scores.map((s) => [`${s.assignmentId}:${s.studentId}`, s]))
  const header: (string | number)[] = [
    'Last name',
    'First name',
    'Email',
    ...assignments.map((a) => `${a.title} (${formatPoints(a.pointsPossible)})`),
    'Average (%)'
  ]
  const body = students.map((st) => {
    const mine = new Map<number, Score>()
    const cells = assignments.map((a) => {
      const s = bySA.get(`${a.id}:${st.id}`)
      if (s) mine.set(a.id, s)
      if (!s) return ''
      if (s.status === 'missing') return 'M'
      if (s.status === 'excused') return 'EX'
      return s.points ?? ''
    })
    const g = computeStudentGrade(mode, assignments, categories, mine)
    return [
      st.lastName,
      st.firstName,
      st.email,
      ...cells,
      g.percent === null ? '' : round1(g.percent)
    ]
  })
  return [header, ...body]
}

/** Every score that carries a flag or a comment, for the workbook's second sheet. */
export function scoreDetailRows(
  students: readonly Student[],
  assignments: readonly Assignment[],
  scores: readonly Score[]
): (string | number)[][] {
  const st = new Map(students.map((s) => [s.id, s]))
  const asg = new Map(assignments.map((a) => [a.id, a]))
  const rows: (string | number)[][] = [
    ['Last name', 'First name', 'Assignment', 'Points', 'Status', 'Comment']
  ]
  for (const s of scores) {
    if (!s.status && !s.comment) continue
    const student = st.get(s.studentId)
    const a = asg.get(s.assignmentId)
    if (!student || !a) continue
    rows.push([
      student.lastName,
      student.firstName,
      a.title,
      s.points ?? '',
      s.status ?? '',
      s.comment
    ])
  }
  return rows
}
