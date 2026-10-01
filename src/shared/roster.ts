import type { ClassInput, StudentInput } from './api'
import type { Student } from './models'

/** A parsed spreadsheet or CSV: every cell as trimmed text. */
export interface TableFile {
  /** Opaque handle. The renderer never sees the file's path, only this token. */
  token: string
  fileName: string
  sheetNames: string[]
  sheet: string | null
  rows: string[][]
}

export const IMPORT_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'preferredName',
  'email',
  'notes',
  'tags'
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const FIELD_LABELS: Record<ImportField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name (one column)',
  preferredName: 'Preferred name',
  email: 'Email',
  notes: 'Notes',
  tags: 'Tags'
}

/** Column index for each field, or null when that field is not in the file. */
export type ImportMapping = Record<ImportField, number | null>

export type ImportTarget = { classId: number } | { newClass: ClassInput }

export interface ImportRequest {
  token: string
  sheet?: string | null
  hasHeader: boolean
  mapping: ImportMapping
  target: ImportTarget
}

export type ImportAction =
  'create' | 'enroll-existing' | 'already-enrolled' | 'duplicate-in-file' | 'invalid'

export interface ImportRowPlan {
  /** 1-based row number as the teacher sees it in the spreadsheet. */
  rowNumber: number
  action: ImportAction
  student?: StudentInput
  matchedStudentId?: number
  note?: string
}

export interface ImportCounts {
  total: number
  create: number
  enrollExisting: number
  alreadyEnrolled: number
  duplicate: number
  invalid: number
}

export interface ImportPreview {
  rows: ImportRowPlan[]
  counts: ImportCounts
}

export interface ImportResult {
  classId: number
  created: number
  enrolledExisting: number
  skipped: number
}

export const emptyMapping = (): ImportMapping => ({
  firstName: null,
  lastName: null,
  fullName: null,
  preferredName: null,
  email: null,
  notes: null,
  tags: null
})

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Header names schools commonly use, most specific first. */
const HEADER_HINTS: [ImportField, RegExp][] = [
  ['preferredName', /^(preferred|nick ?name|goes by|pref)( first)?( ?name)?$/],
  ['email', /(^|\b)e ?mail\b|^email( address)?$/],
  ['firstName', /^(first|given|legal first|student first|fname|f name)( ?name)?$/],
  ['lastName', /^(last|family|sur|legal last|student last|lname|l name)( ?name)?$/],
  ['fullName', /^(student|student name|full name|name|learner|pupil)$/],
  ['notes', /^(notes?|comments?|remarks?)$/],
  ['tags', /^(tags?|groups?|labels?)$/]
]

/** Best-effort mapping from header text; each column is used for at most one field. */
export function guessMapping(headers: string[]): ImportMapping {
  const mapping = emptyMapping()
  const used = new Set<number>()
  for (const [field, re] of HEADER_HINTS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(norm(h)))
    if (i !== -1) {
      mapping[field] = i
      used.add(i)
    }
  }
  // "Last, First" style exports use a single name column; prefer separate columns when both exist.
  if (mapping.firstName !== null && mapping.lastName !== null) mapping.fullName = null
  return mapping
}

/** "Last, First" or "First Middle Last". */
export function splitFullName(full: string): { first: string; last: string } {
  const t = full.trim().replace(/\s+/g, ' ')
  if (!t) return { first: '', last: '' }
  if (t.includes(',')) {
    const [last, ...rest] = t.split(',')
    return { first: rest.join(',').trim(), last: last.trim() }
  }
  const parts = t.split(' ')
  if (parts.length === 1) return { first: '', last: parts[0] }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

const cell = (row: string[], i: number | null): string => (i === null ? '' : (row[i] ?? '').trim())
const nameKey = (first: string, last: string): string => `${norm(first)}|${norm(last)}`
const isBlank = (row: string[]): boolean => row.every((c) => !c.trim())

function parseTags(text: string): string[] {
  return text
    .split(/[;,|]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Decides, row by row, what an import would do. Pure: nothing is written. The same function backs
 * both the preview and the commit, so what the teacher approves is what happens.
 *
 * Matching an existing student: same email, or the same first and last name when either side has
 * no email. Two students with the same name but different emails are treated as different people.
 */
export function planImport(
  rows: string[][],
  hasHeader: boolean,
  mapping: ImportMapping,
  existing: Student[],
  enrolledIds: ReadonlySet<number>
): ImportRowPlan[] {
  const byEmail = new Map<string, Student>()
  const byName = new Map<string, Student[]>()
  for (const s of existing) {
    if (s.email) byEmail.set(s.email.toLowerCase(), s)
    const k = nameKey(s.firstName, s.lastName)
    byName.set(k, [...(byName.get(k) ?? []), s])
  }

  const seenEmail = new Set<string>()
  const seenName = new Set<string>()
  const plans: ImportRowPlan[] = []

  rows.forEach((row, i) => {
    if (hasHeader && i === 0) return
    if (isBlank(row)) return
    const rowNumber = i + 1

    let first = cell(row, mapping.firstName)
    let last = cell(row, mapping.lastName)
    if (!first && !last && mapping.fullName !== null) {
      ;({ first, last } = splitFullName(cell(row, mapping.fullName)))
    }
    const email = cell(row, mapping.email)
    if (!first && !last) {
      plans.push({ rowNumber, action: 'invalid', note: 'No name in this row' })
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
      plans.push({ rowNumber, action: 'invalid', note: `"${email}" is not a valid email` })
      return
    }

    const student: StudentInput = {
      firstName: first,
      lastName: last,
      preferredName: cell(row, mapping.preferredName),
      email,
      notes: cell(row, mapping.notes),
      tags: parseTags(cell(row, mapping.tags))
    }

    // Repeats inside the file.
    const key = nameKey(first, last)
    const emailKey = email.toLowerCase()
    if ((emailKey && seenEmail.has(emailKey)) || (!emailKey && seenName.has(key))) {
      plans.push({
        rowNumber,
        action: 'duplicate-in-file',
        student,
        note: 'Same student appears earlier in the file'
      })
      return
    }
    if (emailKey) seenEmail.add(emailKey)
    else seenName.add(key)

    let match: Student | undefined = emailKey ? byEmail.get(emailKey) : undefined
    if (!match) {
      match = (byName.get(key) ?? []).find((s) => !s.email || !emailKey)
    }
    if (!match) {
      plans.push({ rowNumber, action: 'create', student })
    } else if (enrolledIds.has(match.id)) {
      plans.push({ rowNumber, action: 'already-enrolled', student, matchedStudentId: match.id })
    } else {
      plans.push({
        rowNumber,
        action: 'enroll-existing',
        student,
        matchedStudentId: match.id,
        note: 'Already in your student list; will be added to this class'
      })
    }
  })
  return plans
}

export function countPlans(plans: ImportRowPlan[]): ImportCounts {
  const c: ImportCounts = {
    total: plans.length,
    create: 0,
    enrollExisting: 0,
    alreadyEnrolled: 0,
    duplicate: 0,
    invalid: 0
  }
  for (const p of plans) {
    if (p.action === 'create') c.create++
    else if (p.action === 'enroll-existing') c.enrollExisting++
    else if (p.action === 'already-enrolled') c.alreadyEnrolled++
    else if (p.action === 'duplicate-in-file') c.duplicate++
    else c.invalid++
  }
  return c
}

export const ROSTER_EXPORT_HEADERS = ['Last name', 'First name', 'Preferred name', 'Email', 'Tags']

/** The rows written by a roster export (notes stay private and are not exported). */
export function rosterExportRows(students: Student[]): string[][] {
  return [
    ROSTER_EXPORT_HEADERS,
    ...students.map((s) => [s.lastName, s.firstName, s.preferredName, s.email, s.tags.join('; ')])
  ]
}
