import { guessMapping, splitFullName } from './roster'
import type { ExternalProgress, Student } from './models'

/**
 * Importing grades earned elsewhere (another school, an online course) into an advisee's
 * `external_progress`. One spreadsheet row is one grade for one student: who, which course, the
 * grade, and optionally the term, where it came from and the date it is as of.
 */

export const PROGRESS_LIMITS = { course: 200, term: 100, grade: 50, source: 200 } as const

export interface ProgressImportMapping {
  firstName: number | null
  lastName: number | null
  fullName: number | null
  email: number | null
  course: number | null
  grade: number | null
  term: number | null
  source: number | null
  recordedOn: number | null
}

/** Used for any row where the column is not in the file or the cell is blank. */
export interface ProgressImportDefaults {
  term: string
  source: string
  /** YYYY-MM-DD */
  recordedOn: string | null
}

export interface ProgressImportRequest {
  token: string
  sheet?: string | null
  hasHeader: boolean
  mapping: ProgressImportMapping
  defaults: ProgressImportDefaults
}

export type ProgressAction =
  'create' | 'update' | 'unchanged' | 'unmatched' | 'duplicate-in-file' | 'invalid'

export interface ProgressEntry {
  course: string
  term: string
  grade: string
  source: string
  recordedOn: string | null
}

export interface ProgressRowPlan {
  /** 1-based row number as the teacher sees it in the spreadsheet. */
  rowNumber: number
  /** "Last, First" as written in the file. */
  label: string
  action: ProgressAction
  studentId: number | null
  entry?: ProgressEntry
  /** The stored entry this row updates. */
  existingId?: number
  /** The stored grade it replaces, for the preview. */
  previousGrade?: string
  note?: string
}

export interface ProgressImportCounts {
  total: number
  create: number
  update: number
  unchanged: number
  unmatched: number
  duplicate: number
  invalid: number
}

export interface ProgressImportPlan {
  rows: ProgressRowPlan[]
  counts: ProgressImportCounts
}

export interface ProgressImportResult {
  created: number
  updated: number
  unchanged: number
  skipped: number
}

export const emptyProgressMapping = (): ProgressImportMapping => ({
  firstName: null,
  lastName: null,
  fullName: null,
  email: null,
  course: null,
  grade: null,
  term: null,
  source: null,
  recordedOn: null
})

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Header names for the columns that are about the grade, not the student. */
const HEADER_HINTS: [keyof ProgressImportMapping, RegExp][] = [
  ['recordedOn', /^(date|as of|as of date|recorded|recorded on|reported|updated|date recorded)$/],
  ['term', /^(term|semester|quarter|trimester|session|marking period)$/],
  ['source', /^(source|school|provider|institution|platform|reported by|from)$/],
  ['course', /^(course|course name|class|subject|class name)$/],
  [
    'grade',
    /^(grade|final grade|current grade|letter grade|mark|result|score|percent|percentage|final|%)$/
  ]
]

/** Best-effort mapping from header text; each column is used for at most one field. */
export function detectProgressColumns(headers: string[]): ProgressImportMapping {
  const ident = guessMapping(headers)
  const mapping: ProgressImportMapping = {
    ...emptyProgressMapping(),
    firstName: ident.firstName,
    lastName: ident.lastName,
    fullName: ident.fullName,
    email: ident.email
  }
  const used = new Set(
    [ident.firstName, ident.lastName, ident.fullName, ident.email].filter(
      (i): i is number => i !== null
    )
  )
  for (const [field, re] of HEADER_HINTS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(norm(h)))
    if (i !== -1) {
      mapping[field] = i
      used.add(i)
    }
  }
  return mapping
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const MONTH_NAMES: Record<string, string> = {
  jan: 'january',
  feb: 'february',
  mar: 'march',
  apr: 'april',
  may: 'may',
  jun: 'june',
  jul: 'july',
  aug: 'august',
  sep: 'september',
  oct: 'october',
  nov: 'november',
  dec: 'december'
}

function ymd(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A date as a school export or a spreadsheet writes it: 2026-10-01, 10/1/2026 (month first), 10/1/26,
 * Oct 1, 2026 or 1 October 2026. Null when it is not a real date.
 */
export function parseDateText(raw: string): string | null {
  const t = raw.trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t)
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(t)
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return ymd(year, Number(m[1]), Number(m[2]))
  }
  // A full name or its three-letter form ("Sept" too), never just a matching start: "Octember" is no month.
  const month = (name: string): number => {
    const n = name.toLowerCase()
    const i = MONTHS.findIndex((abbr) => n === abbr || n === MONTH_NAMES[abbr])
    return n === 'sept' ? 9 : i + 1
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(t)
  if (m && month(m[1]) > 0) return ymd(Number(m[3]), month(m[1]), Number(m[2]))
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t)
  if (m && month(m[2]) > 0) return ymd(Number(m[3]), month(m[2]), Number(m[1]))
  return null
}

const cellAt = (row: string[], i: number | null): string =>
  i === null ? '' : (row[i] ?? '').trim()
const nameKey = (first: string, last: string): string => `${norm(first)}|${norm(last)}`
const entryKey = (
  studentId: number,
  e: Pick<ProgressEntry, 'course' | 'term' | 'source'>
): string => `${studentId}|${norm(e.course)}|${norm(e.term)}|${norm(e.source)}`

/**
 * Decides, without writing anything, what an import would do. Rows are matched to advisees only, by
 * email and then by name. A row whose student, course, term and source match a stored entry updates
 * it rather than adding a second one, so importing the same export again changes nothing. The
 * same function backs the preview and the commit.
 */
export function planProgressImport(
  rows: string[][],
  hasHeader: boolean,
  mapping: ProgressImportMapping,
  defaults: ProgressImportDefaults,
  advisees: readonly Student[],
  existing: readonly ExternalProgress[]
): ProgressImportPlan {
  const byEmail = new Map<string, Student>()
  const byName = new Map<string, Student[]>()
  for (const s of advisees) {
    if (s.email) byEmail.set(s.email.toLowerCase(), s)
    const k = nameKey(s.firstName, s.lastName)
    byName.set(k, [...(byName.get(k) ?? []), s])
  }
  const stored = new Map<string, ExternalProgress>()
  for (const e of existing) {
    // The oldest entry for a key is the one a re-import updates.
    const k = entryKey(e.studentId, e)
    if (!stored.has(k)) stored.set(k, e)
  }

  const plan: ProgressImportPlan = {
    rows: [],
    counts: { total: 0, create: 0, update: 0, unchanged: 0, unmatched: 0, duplicate: 0, invalid: 0 }
  }
  const seen = new Set<string>()
  const push = (p: ProgressRowPlan): void => {
    plan.rows.push(p)
    plan.counts.total++
    if (p.action === 'create') plan.counts.create++
    else if (p.action === 'update') plan.counts.update++
    else if (p.action === 'unchanged') plan.counts.unchanged++
    else if (p.action === 'unmatched') plan.counts.unmatched++
    else if (p.action === 'duplicate-in-file') plan.counts.duplicate++
    else plan.counts.invalid++
  }

  rows.forEach((row, i) => {
    if (hasHeader && i === 0) return
    if (row.every((c) => !c.trim())) return
    const rowNumber = i + 1

    let first = cellAt(row, mapping.firstName)
    let last = cellAt(row, mapping.lastName)
    if (!first && !last && mapping.fullName !== null)
      ({ first, last } = splitFullName(cellAt(row, mapping.fullName)))
    const email = cellAt(row, mapping.email).toLowerCase()
    const label = [last, first].filter(Boolean).join(', ') || email || `Row ${rowNumber}`

    const course = cellAt(row, mapping.course)
    const grade = cellAt(row, mapping.grade)
    const term = cellAt(row, mapping.term) || defaults.term
    const source = cellAt(row, mapping.source) || defaults.source
    const dateText = cellAt(row, mapping.recordedOn)
    const invalid = (note: string): void =>
      push({ rowNumber, label, action: 'invalid', studentId: null, note })

    if (!course) return invalid('No course in this row')
    if (!grade) return invalid('No grade in this row')
    for (const [name, value, max] of [
      ['Course', course, PROGRESS_LIMITS.course],
      ['Grade', grade, PROGRESS_LIMITS.grade],
      ['Term', term, PROGRESS_LIMITS.term],
      ['Source', source, PROGRESS_LIMITS.source]
    ] as const) {
      if (value.length > max) return invalid(`${name} is too long (the limit is ${max} characters)`)
    }
    let recordedOn = defaults.recordedOn
    if (dateText) {
      const parsed = parseDateText(dateText)
      if (!parsed) return invalid(`"${dateText}" is not a date. Use a date like 2026-10-01.`)
      recordedOn = parsed
    }

    let student: Student | undefined = email ? byEmail.get(email) : undefined
    if (!student && (first || last)) {
      const candidates = byName.get(nameKey(first, last)) ?? []
      if (candidates.length > 1) {
        push({
          rowNumber,
          label,
          action: 'unmatched',
          studentId: null,
          note: 'More than one advisee has that name. Add an email column to tell them apart.'
        })
        return
      }
      student = candidates[0]
    }
    if (!student) {
      push({
        rowNumber,
        label,
        action: 'unmatched',
        studentId: null,
        note: 'No advisee with that name or email. A student only appears here once tagged "advisee".'
      })
      return
    }

    const entry: ProgressEntry = { course, term, grade, source, recordedOn }
    const key = entryKey(student.id, entry)
    if (seen.has(key)) {
      push({
        rowNumber,
        label,
        action: 'duplicate-in-file',
        studentId: student.id,
        entry,
        note: 'Same student, course, term and source appear earlier in the file'
      })
      return
    }
    seen.add(key)

    const prev = stored.get(key)
    if (!prev) {
      push({ rowNumber, label, action: 'create', studentId: student.id, entry })
      return
    }
    // A file with no date must not blank the date already on the entry.
    const kept: ProgressEntry = { ...entry, recordedOn: entry.recordedOn ?? prev.recordedOn }
    const same = prev.grade === kept.grade && prev.recordedOn === kept.recordedOn
    push({
      rowNumber,
      label,
      action: same ? 'unchanged' : 'update',
      studentId: student.id,
      entry: kept,
      existingId: prev.id,
      previousGrade: prev.grade
    })
  })
  return plan
}
