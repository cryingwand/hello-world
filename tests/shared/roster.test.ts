import { describe, expect, it } from 'vitest'
import {
  countPlans,
  emptyMapping,
  guessMapping,
  planImport,
  rosterExportRows,
  splitFullName
} from '@shared/roster'
import type { Student } from '@shared/models'

const student = (id: number, over: Partial<Student> = {}): Student => ({
  id,
  firstName: 'First',
  lastName: 'Last',
  preferredName: '',
  email: '',
  notes: '',
  tags: [],
  ...over
})

describe('guessMapping', () => {
  it('maps common school export headers', () => {
    const m = guessMapping([
      'Student ID',
      'Last Name',
      'First Name',
      'Preferred Name',
      'E-mail',
      'Grade'
    ])
    expect(m).toMatchObject({
      lastName: 1,
      firstName: 2,
      preferredName: 3,
      email: 4,
      fullName: null
    })
  })

  it('handles headers without spaces and different case', () => {
    expect(guessMapping(['FIRSTNAME', 'lastname', 'EMAIL'])).toMatchObject({
      firstName: 0,
      lastName: 1,
      email: 2
    })
    expect(guessMapping(['Given Name', 'Surname'])).toMatchObject({ firstName: 0, lastName: 1 })
  })

  it('falls back to a single name column and never reuses a column', () => {
    const m = guessMapping(['Student', 'Email Address'])
    expect(m).toMatchObject({ fullName: 0, email: 1, firstName: null, lastName: null })
    const used = Object.values(m).filter((i): i is number => i !== null)
    expect(new Set(used).size).toBe(used.length)
  })

  it('drops the full-name column when first and last both exist', () => {
    expect(guessMapping(['Name', 'First', 'Last']).fullName).toBeNull()
  })

  it('finds nothing in unrelated headers', () => {
    expect(guessMapping(['Locker', 'Homeroom'])).toEqual(emptyMapping())
  })
})

describe('splitFullName', () => {
  it.each([
    ['Lovelace, Ada', { first: 'Ada', last: 'Lovelace' }],
    ['Ada Lovelace', { first: 'Ada', last: 'Lovelace' }],
    ['Ada Augusta King Lovelace', { first: 'Ada Augusta King', last: 'Lovelace' }],
    ['Cher', { first: '', last: 'Cher' }],
    ['  Turing ,  Alan  ', { first: 'Alan', last: 'Turing' }],
    ['', { first: '', last: '' }]
  ])('%j', (input, expected) => expect(splitFullName(input)).toEqual(expected))
})

describe('planImport', () => {
  const header = ['Last', 'First', 'Email', 'Tags']
  const map = { ...emptyMapping(), lastName: 0, firstName: 1, email: 2, tags: 3 }
  const run = (rows: string[][], existing: Student[] = [], enrolled: number[] = []) =>
    planImport([header, ...rows], true, map, existing, new Set(enrolled))

  it('creates new students and numbers rows as the spreadsheet does', () => {
    const plans = run([['Lovelace', 'Ada', 'ada@x.org', 'advisee; iep']])
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ rowNumber: 2, action: 'create' })
    expect(plans[0].student).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      tags: ['advisee', 'iep']
    })
  })

  it('skips blank rows without disturbing later row numbers', () => {
    const plans = run([
      ['A', 'One', '', ''],
      ['', '', '', ''],
      ['B', 'Two', '', '']
    ])
    expect(plans.map((p) => p.rowNumber)).toEqual([2, 4])
  })

  it('flags rows with no name or a malformed email', () => {
    const plans = run([
      ['', '', 'a@b.co', ''],
      ['Smith', 'Sam', 'not-an-email', '']
    ])
    expect(plans.map((p) => p.action)).toEqual(['invalid', 'invalid'])
    expect(plans[1].note).toMatch(/not a valid email/)
  })

  it('matches an existing student by email and enrolls instead of duplicating', () => {
    const ex = [student(7, { firstName: 'Ada', lastName: 'Lovelace', email: 'ADA@x.org' })]
    const [p] = run([['Lovelace', 'Ada', 'ada@X.org', '']], ex)
    expect(p).toMatchObject({ action: 'enroll-existing', matchedStudentId: 7 })
  })

  it('matches by name when either side lacks an email', () => {
    const ex = [student(7, { firstName: 'Ada', lastName: 'Lovelace' })]
    expect(run([['lovelace', 'ADA', 'ada@x.org', '']], ex)[0]).toMatchObject({
      action: 'enroll-existing',
      matchedStudentId: 7
    })
    const ex2 = [student(8, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.org' })]
    expect(run([['Lovelace', 'Ada', '', '']], ex2)[0]).toMatchObject({
      action: 'enroll-existing',
      matchedStudentId: 8
    })
  })

  it('treats same name with different emails as different people', () => {
    const ex = [student(9, { firstName: 'Sam', lastName: 'Lee', email: 'sam1@x.org' })]
    expect(run([['Lee', 'Sam', 'sam2@x.org', '']], ex)[0].action).toBe('create')
  })

  it('reports students already in the class', () => {
    const ex = [student(3, { firstName: 'Ada', lastName: 'Lovelace' })]
    expect(run([['Lovelace', 'Ada', '', '']], ex, [3])[0]).toMatchObject({
      action: 'already-enrolled',
      matchedStudentId: 3
    })
  })

  it('flags repeats inside the file by email, and by name when there is no email', () => {
    const plans = run([
      ['A', 'One', 'one@x.org', ''],
      ['A', 'One', 'ONE@x.org', ''],
      ['B', 'Two', '', ''],
      ['b', 'two', '', ''],
      ['B', 'Two', 'two@x.org', '']
    ])
    expect(plans.map((p) => p.action)).toEqual([
      'create',
      'duplicate-in-file',
      'create',
      'duplicate-in-file',
      'create'
    ])
  })

  it('splits a single full-name column', () => {
    const m = { ...emptyMapping(), fullName: 0 }
    const plans = planImport([['Name'], ['Lovelace, Ada'], ['Alan Turing']], true, m, [], new Set())
    expect(plans.map((p) => `${p.student?.firstName} ${p.student?.lastName}`)).toEqual([
      'Ada Lovelace',
      'Alan Turing'
    ])
  })

  it('reads the first row as data when there is no header', () => {
    const plans = planImport([['Lovelace', 'Ada', '', '']], false, map, [], new Set())
    expect(plans).toHaveLength(1)
    expect(plans[0].rowNumber).toBe(1)
  })

  it('tolerates short rows', () => {
    const plans = planImport([['Lovelace']], false, map, [], new Set())
    expect(plans[0]).toMatchObject({
      action: 'create',
      student: { lastName: 'Lovelace', firstName: '' }
    })
  })

  it('counts every action', () => {
    const ex = [
      student(1, { firstName: 'E', lastName: 'One' }),
      student(2, { firstName: 'E', lastName: 'Two' })
    ]
    const plans = run(
      [
        ['New', 'N', '', ''],
        ['One', 'E', '', ''],
        ['Two', 'E', '', ''],
        ['New', 'N', '', ''],
        ['', '', 'x@y.zz', '']
      ],
      ex,
      [2]
    )
    expect(countPlans(plans)).toEqual({
      total: 5,
      create: 1,
      enrollExisting: 1,
      alreadyEnrolled: 1,
      duplicate: 1,
      invalid: 1
    })
  })
})

describe('rosterExportRows', () => {
  it('writes a header, joins tags, and leaves private notes out', () => {
    const rows = rosterExportRows([
      student(1, {
        firstName: 'Ada',
        lastName: 'Lovelace',
        tags: ['advisee', 'iep'],
        notes: 'secret'
      })
    ])
    expect(rows[0]).toEqual(['Last name', 'First name', 'Preferred name', 'Email', 'Tags'])
    expect(rows[1]).toEqual(['Lovelace', 'Ada', '', '', 'advisee; iep'])
    expect(JSON.stringify(rows)).not.toContain('secret')
  })
})
