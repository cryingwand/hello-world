import { describe, expect, it } from 'vitest'
import type { ExternalProgress, Student } from '@shared/models'
import {
  detectProgressColumns,
  emptyProgressMapping,
  parseDateText,
  planProgressImport,
  type ProgressImportDefaults,
  type ProgressImportMapping
} from '@shared/progressImport'

const student = (id: number, first: string, last: string, email = ''): Student => ({
  id,
  firstName: first,
  lastName: last,
  preferredName: '',
  email,
  notes: '',
  tags: ['advisee']
})
const stored = (
  id: number,
  studentId: number,
  course: string,
  grade: string,
  over: Partial<ExternalProgress> = {}
): ExternalProgress => ({
  id,
  studentId,
  course,
  term: '',
  grade,
  source: '',
  recordedOn: null,
  ...over
})

const NO_DEFAULTS: ProgressImportDefaults = { term: '', source: '', recordedOn: null }
const HEADER = ['Last name', 'First name', 'Email', 'Course', 'Grade', 'Term', 'Source', 'As of']
const mapping = (over: Partial<ProgressImportMapping> = {}): ProgressImportMapping => ({
  ...detectProgressColumns(HEADER),
  ...over
})

describe('parseDateText', () => {
  it('reads the formats a school export or a spreadsheet writes', () => {
    expect(parseDateText('2026-10-01')).toBe('2026-10-01')
    expect(parseDateText('2026/1/5')).toBe('2026-01-05')
    expect(parseDateText('10/1/2026')).toBe('2026-10-01')
    expect(parseDateText('10/1/26')).toBe('2026-10-01')
    expect(parseDateText('Oct 1, 2026')).toBe('2026-10-01')
    expect(parseDateText('October 1st, 2026')).toBe('2026-10-01')
    expect(parseDateText('1 October 2026')).toBe('2026-10-01')
  })
  it('refuses things that are not real dates', () => {
    expect(parseDateText('2026-02-30')).toBeNull()
    expect(parseDateText('13/1/2026')).toBeNull()
    expect(parseDateText('Octember 1, 2026')).toBeNull()
    expect(parseDateText('soon')).toBeNull()
    expect(parseDateText('')).toBeNull()
  })
})

describe('detectProgressColumns', () => {
  it('finds the student and grade columns from common headers', () => {
    expect(detectProgressColumns(HEADER)).toEqual({
      firstName: 1,
      lastName: 0,
      fullName: null,
      email: 2,
      course: 3,
      grade: 4,
      term: 5,
      source: 6,
      recordedOn: 7
    })
  })
  it('leaves what it cannot recognise unset', () => {
    expect(detectProgressColumns(['Who', 'Thing'])).toEqual(emptyProgressMapping())
  })
  it('uses a single name column when there are no separate ones', () => {
    const m = detectProgressColumns(['Student', 'Course', 'Final grade'])
    expect(m).toMatchObject({ fullName: 0, course: 1, grade: 2 })
  })
})

describe('planProgressImport', () => {
  const advisees = [
    student(1, 'Priya', 'Abernathy', 'priya@example.org'),
    student(2, 'Tomas', 'Bellweather'),
    student(3, 'Wren', 'Castellanos')
  ]
  const run = (
    rows: string[][],
    existing: ExternalProgress[] = [],
    over: Partial<ProgressImportMapping> = {},
    defaults = NO_DEFAULTS,
    people = advisees
  ) => planProgressImport([HEADER, ...rows], true, mapping(over), defaults, people, existing)

  it('creates an entry for each matched row', () => {
    const plan = run([
      ['Abernathy', 'Priya', '', 'Algebra II', 'B+', 'Fall 2026', 'Westside HS', '10/1/2026'],
      ['Bellweather', 'Tomas', '', 'Art', '91', '', '', '']
    ])
    expect(plan.counts).toMatchObject({ total: 2, create: 2 })
    expect(plan.rows[0]).toMatchObject({
      rowNumber: 2,
      action: 'create',
      studentId: 1,
      entry: {
        course: 'Algebra II',
        grade: 'B+',
        term: 'Fall 2026',
        source: 'Westside HS',
        recordedOn: '2026-10-01'
      }
    })
    expect(plan.rows[1].entry).toMatchObject({ term: '', source: '', recordedOn: null })
  })

  it('matches by email before name', () => {
    const plan = run([['Wrongname', 'Nobody', 'PRIYA@example.org', 'Algebra II', 'A', '', '', '']])
    expect(plan.rows[0]).toMatchObject({ action: 'create', studentId: 1 })
  })

  it('fills blanks from the defaults, but never overrides a cell', () => {
    const plan = run(
      [
        ['Abernathy', 'Priya', '', 'Algebra II', 'B', '', '', ''],
        ['Bellweather', 'Tomas', '', 'Art', 'A', 'Spring 2026', 'Other', '2026-05-01']
      ],
      [],
      {},
      { term: 'Fall 2026', source: 'Khan Academy', recordedOn: '2026-10-01' }
    )
    expect(plan.rows[0].entry).toMatchObject({
      term: 'Fall 2026',
      source: 'Khan Academy',
      recordedOn: '2026-10-01'
    })
    expect(plan.rows[1].entry).toMatchObject({
      term: 'Spring 2026',
      source: 'Other',
      recordedOn: '2026-05-01'
    })
  })

  it('does not match students who are not advisees', () => {
    const plan = run([['Nobody', 'Here', '', 'Art', 'A', '', '', '']])
    expect(plan.rows[0]).toMatchObject({ action: 'unmatched', studentId: null })
    expect(plan.rows[0].note).toMatch(/advisee/)
    expect(plan.counts.unmatched).toBe(1)
  })

  it('refuses to guess between two advisees with the same name', () => {
    const twins = [student(4, 'Priya', 'Abernathy'), student(5, 'Priya', 'Abernathy')]
    const byName = run(
      [['Abernathy', 'Priya', '', 'Art', 'A', '', '', '']],
      [],
      {},
      NO_DEFAULTS,
      twins
    )
    expect(byName.rows[0]).toMatchObject({ action: 'unmatched', studentId: null })
    expect(byName.rows[0].note).toMatch(/email/)
    // An email column settles it.
    const withEmail = run(
      [['Abernathy', 'Priya', 'p2@example.org', 'Art', 'A', '', '', '']],
      [],
      {},
      NO_DEFAULTS,
      [
        student(4, 'Priya', 'Abernathy', 'p1@example.org'),
        student(5, 'Priya', 'Abernathy', 'p2@example.org')
      ]
    )
    expect(withEmail.rows[0]).toMatchObject({ action: 'create', studentId: 5 })
  })

  it('updates the entry for the same student, course, term and source instead of adding another', () => {
    const plan = run(
      [['Abernathy', 'Priya', '', 'algebra  II', 'A-', 'Fall 2026', '', '']],
      [stored(9, 1, 'Algebra II', 'B+', { term: 'Fall 2026' })]
    )
    expect(plan.rows[0]).toMatchObject({
      action: 'update',
      existingId: 9,
      previousGrade: 'B+',
      entry: { grade: 'A-' }
    })
  })

  it('treats a different term as a different entry', () => {
    const plan = run(
      [['Abernathy', 'Priya', '', 'Algebra II', 'A-', 'Spring 2027', '', '']],
      [stored(9, 1, 'Algebra II', 'B+', { term: 'Fall 2026' })]
    )
    expect(plan.rows[0].action).toBe('create')
  })

  it('reports an identical row as unchanged, so re-importing a file changes nothing', () => {
    const plan = run(
      [['Abernathy', 'Priya', '', 'Algebra II', 'B+', '', '', '2026-10-01']],
      [stored(9, 1, 'Algebra II', 'B+', { recordedOn: '2026-10-01' })]
    )
    expect(plan.rows[0].action).toBe('unchanged')
    expect(plan.counts).toMatchObject({ unchanged: 1, create: 0, update: 0 })
  })

  it('keeps the stored date when the file has none', () => {
    const plan = run(
      [['Abernathy', 'Priya', '', 'Algebra II', 'A', '', '', '']],
      [stored(9, 1, 'Algebra II', 'B+', { recordedOn: '2026-09-01' })]
    )
    expect(plan.rows[0]).toMatchObject({
      action: 'update',
      entry: { grade: 'A', recordedOn: '2026-09-01' }
    })
  })

  it('skips a repeat of the same key inside the file', () => {
    const plan = run([
      ['Abernathy', 'Priya', '', 'Algebra II', 'B', '', '', ''],
      ['Abernathy', 'Priya', '', 'Algebra II', 'A', '', '', '']
    ])
    expect(plan.rows.map((r) => r.action)).toEqual(['create', 'duplicate-in-file'])
  })

  it('flags rows it cannot use, with a reason', () => {
    const plan = run([
      ['Abernathy', 'Priya', '', '', 'B', '', '', ''],
      ['Abernathy', 'Priya', '', 'Art', '', '', '', ''],
      ['Abernathy', 'Priya', '', 'Art', 'B', '', '', 'next week'],
      ['Abernathy', 'Priya', '', 'x'.repeat(201), 'B', '', '', '']
    ])
    expect(plan.rows.map((r) => r.action)).toEqual(['invalid', 'invalid', 'invalid', 'invalid'])
    expect(plan.rows[0].note).toMatch(/course/i)
    expect(plan.rows[1].note).toMatch(/grade/i)
    expect(plan.rows[2].note).toMatch(/not a date/)
    expect(plan.rows[3].note).toMatch(/too long/)
  })

  it('ignores blank rows and the header, and reports spreadsheet row numbers', () => {
    const plan = run([
      ['', '', '', '', '', '', '', ''],
      ['Abernathy', 'Priya', '', 'Art', 'A', '', '', '']
    ])
    expect(plan.counts.total).toBe(1)
    expect(plan.rows[0].rowNumber).toBe(3)
  })

  it('reads a single name column', () => {
    const rows = [
      ['Student', 'Course', 'Grade'],
      ['Bellweather, Tomas', 'Art', 'A']
    ]
    const plan = planProgressImport(
      rows,
      true,
      detectProgressColumns(rows[0]),
      NO_DEFAULTS,
      advisees,
      []
    )
    expect(plan.rows[0]).toMatchObject({
      action: 'create',
      studentId: 2,
      label: 'Bellweather, Tomas'
    })
  })
})
