import { describe, expect, it } from 'vitest'
import type { Assignment, GradeCategory, Score, Student } from '@shared/models'
import {
  detectScoreColumns,
  parseColumnHeader,
  parseScoreCell,
  planScoreImport,
  scoreDetailRows,
  scoreExportRows
} from '@shared/scoreImport'

const student = (id: number, first: string, last: string, email = ''): Student => ({
  id,
  firstName: first,
  lastName: last,
  preferredName: '',
  email,
  notes: '',
  tags: []
})
const asg = (
  id: number,
  title: string,
  pointsPossible: number,
  categoryId: number | null = null
): Assignment => ({
  id,
  classId: 1,
  categoryId,
  title,
  pointsPossible,
  dueDate: null,
  sourceApp: null,
  sourceId: null,
  sortOrder: id
})
const score = (
  assignmentId: number,
  studentId: number,
  points: number | null,
  status: Score['status'] = null,
  comment = ''
): Score => ({
  id: assignmentId * 100 + studentId,
  assignmentId,
  studentId,
  points,
  status,
  comment
})

describe('parseScoreCell', () => {
  it.each([
    ['', { kind: 'blank' }],
    ['  ', { kind: 'blank' }],
    ['-', { kind: 'blank' }],
    ['N/A', { kind: 'blank' }],
    ['18', { kind: 'points', points: 18 }],
    ['18.5', { kind: 'points', points: 18.5 }],
    ['18,5', { kind: 'points', points: 18.5 }],
    ['.5', { kind: 'points', points: 0.5 }],
    ['0', { kind: 'points', points: 0 }],
    ['M', { kind: 'status', status: 'missing' }],
    ['missing', { kind: 'status', status: 'missing' }],
    ['EX', { kind: 'status', status: 'excused' }],
    ['Excused', { kind: 'status', status: 'excused' }],
    ['85%', { kind: 'invalid', text: '85%' }],
    ['abc', { kind: 'invalid', text: 'abc' }],
    ['-3', { kind: 'invalid', text: '-3' }], // negative scores are not accepted
    ['1e3', { kind: 'invalid', text: '1e3' }]
  ])('%j', (input, expected) => expect(parseScoreCell(input)).toEqual(expected))
})

describe('parseColumnHeader', () => {
  it.each([
    ['Quiz 1 (20)', 'Quiz 1', 20],
    ['Essay [50 pts]', 'Essay', 50],
    ['HW 1 /10', 'HW 1', 10],
    ['HW 1/10', 'HW 1', 10],
    ['Lab - 15 pts', 'Lab', 15],
    ['Lab — 12.5 points', 'Lab', 12.5],
    ['Unit 2 - Review', 'Unit 2 - Review', null],
    ['Unit Test', 'Unit Test', null],
    ['Chapter 3 Quiz (Form B) (25)', 'Chapter 3 Quiz (Form B)', 25],
    ['(20)', '(20)', null]
  ])('%s', (header, title, points) => expect(parseColumnHeader(header)).toEqual({ title, points }))
})

const SCHOOL_EXPORT = [
  [
    'Student ID',
    'Last Name',
    'First Name',
    'Student Email',
    'Quiz 1 (20)',
    'Essay [50]',
    'HW 1 /10',
    'Lab - 15 pts',
    'Unit Test',
    'Total',
    'Current Grade',
    'Comments',
    'Grade'
  ],
  [
    '100200',
    'Abernathy',
    'Priya',
    'priya@example.org',
    '18',
    '45',
    '10',
    'M',
    '88',
    '161',
    '91.2%',
    'good',
    '10'
  ],
  [
    '100201',
    'Bellweather',
    'Tomas',
    'tomas@example.org',
    '15.5',
    'EX',
    '',
    '12',
    '75',
    '102',
    '78.0%',
    '',
    '10'
  ],
  [
    '100202',
    'Castellanos',
    'Wren',
    'wren@example.org',
    '20',
    '50',
    '9',
    '15',
    '92',
    '186',
    '95.0%',
    '',
    '10'
  ]
]

describe('detectScoreColumns', () => {
  it('finds identity columns, assignment columns and points from headers, and skips summaries', () => {
    const { mapping, notes } = detectScoreColumns(SCHOOL_EXPORT, true, false)
    expect(mapping).toMatchObject({ lastName: 1, firstName: 2, email: 3, fullName: null })
    expect(mapping.columns.map((c) => [c.title, c.pointsPossible, c.index])).toEqual([
      ['Quiz 1', 20, 4],
      ['Essay', 50, 5],
      ['HW 1', 10, 6],
      ['Lab', 15, 7],
      ['Unit Test', 0, 8]
    ])
    expect(notes.join('\n')).toMatch(/Total/)
    expect(notes.join('\n')).toMatch(/Current Grade/)
    expect(notes.join('\n')).toMatch(/Student ID/)
  })

  it('reads points possible from a row under the header', () => {
    const rows = [
      ['Name', 'Quiz 1', 'Essay', 'Average'],
      ['Points Possible', '20', '50', ''],
      ['Lovelace, Ada', '18', '40', '90']
    ]
    const { mapping } = detectScoreColumns(rows, true, true)
    expect(mapping.fullName).toBe(0)
    expect(mapping.columns.map((c) => [c.title, c.pointsPossible])).toEqual([
      ['Quiz 1', 20],
      ['Essay', 50]
    ])
  })

  it('skips columns of text and empty columns', () => {
    const rows = [
      ['Last', 'First', 'Notes to self', 'Empty', 'Quiz'],
      ['A', 'B', 'call parent', '', '9'],
      ['C', 'D', 'great', '', '8']
    ]
    expect(detectScoreColumns(rows, true, false).mapping.columns.map((c) => c.title)).toEqual([
      'Quiz'
    ])
  })
})

describe('planScoreImport', () => {
  const roster = [
    student(1, 'Priya', 'Abernathy', 'priya@example.org'),
    student(2, 'Tomas', 'Bellweather'),
    student(3, 'Wren', 'Castellanos', 'WREN@example.org')
  ]
  const detect = () => detectScoreColumns(SCHOOL_EXPORT, true, false).mapping

  it('matches students by email then name, and new assignments are created', () => {
    const plan = planScoreImport(SCHOOL_EXPORT, true, false, detect(), roster, [], [])
    expect(plan.rows.map((r) => r.studentId)).toEqual([1, 2, 3])
    expect(plan.counts).toMatchObject({
      rows: 3,
      matchedStudents: 3,
      unmatchedStudents: 0,
      newAssignments: 5,
      existingAssignments: 0
    })
    // 3 students x 5 columns, minus one blank (Tomas HW 1)
    expect(plan.counts.scoresToWrite).toBe(14)
    expect(plan.problems).toEqual([])
  })

  it('records missing and excused as flags without points', () => {
    const plan = planScoreImport(SCHOOL_EXPORT, true, false, detect(), roster, [], [])
    const lab = plan.changes.find((c) => c.studentId === 1 && c.column === 3)!
    expect(lab).toMatchObject({ points: null, status: 'missing' })
    const essay = plan.changes.find((c) => c.studentId === 2 && c.column === 1)!
    expect(essay).toMatchObject({ points: null, status: 'excused' })
  })

  it('reports row numbers as the spreadsheet shows them', () => {
    const rows = [
      ...SCHOOL_EXPORT,
      ['100203', 'Nobody', 'Here', '', '5', '5', '5', '5', '5', '', '', '', '']
    ]
    const plan = planScoreImport(rows, true, false, detect(), roster, [], [])
    expect(plan.problems).toEqual([{ rowNumber: 5, message: expect.stringMatching(/Nobody/) }])
    expect(plan.rows[3]).toMatchObject({ rowNumber: 5, studentId: null })
  })

  it('reuses existing assignments by title, ignoring case, and detects unchanged scores', () => {
    const existing = [asg(10, 'quiz 1', 20)]
    const scores = [score(10, 1, 18), score(10, 3, 19)]
    const plan = planScoreImport(SCHOOL_EXPORT, true, false, detect(), roster, existing, scores)
    expect(plan.assignments[0]).toMatchObject({ title: 'Quiz 1', existingId: 10 })
    const q1 = plan.changes.filter((c) => c.column === 0)
    expect(q1.find((c) => c.studentId === 1)).toMatchObject({ assignmentId: 10, unchanged: true }) // 18 == 18
    expect(q1.find((c) => c.studentId === 3)).toMatchObject({ unchanged: false, points: 20 }) // 19 -> 20
    expect(q1.find((c) => c.studentId === 2)).toMatchObject({ unchanged: false, points: 15.5 }) // new score
    expect(plan.counts.unchanged).toBe(1)
  })

  it('never erases a stored score for a blank cell', () => {
    const existing = [asg(10, 'HW 1', 10)]
    const scores = [score(10, 2, 7)]
    const plan = planScoreImport(SCHOOL_EXPORT, true, false, detect(), roster, existing, scores)
    expect(plan.changes.some((c) => c.studentId === 2 && c.assignmentId === 10)).toBe(false)
  })

  it('keeps a late flag when the number is imported again, but replaces missing/excused', () => {
    const existing = [asg(10, 'Quiz 1', 20), asg(11, 'Essay', 50)]
    const scores = [score(10, 1, 18, 'late'), score(11, 1, null, 'missing')]
    const plan = planScoreImport(SCHOOL_EXPORT, true, false, detect(), roster, existing, scores)
    expect(plan.changes.find((c) => c.studentId === 1 && c.assignmentId === 10)).toMatchObject({
      status: 'late',
      unchanged: true
    })
    expect(plan.changes.find((c) => c.studentId === 1 && c.assignmentId === 11)).toMatchObject({
      points: 45,
      status: null,
      unchanged: false
    })
  })

  it('flags cells that are not scores and carries on', () => {
    const rows = SCHOOL_EXPORT.map((r) => [...r])
    rows[1][4] = '85%'
    rows[2][5] = 'oops'
    const plan = planScoreImport(rows, true, false, detect(), roster, [], [])
    expect(plan.counts.invalidCells).toBe(2)
    expect(plan.problems.map((p) => p.rowNumber)).toEqual([2, 3])
    expect(plan.problems[0].message).toMatch(/Quiz 1.*85%.*not a score/)
    expect(plan.changes.some((c) => c.studentId === 1 && c.column === 0)).toBe(false)
  })

  it('will not guess between two students with the same name', () => {
    const twins = [student(1, 'Sam', 'Lee'), student(2, 'Sam', 'Lee')]
    const rows = [
      ['Last', 'First', 'Quiz (10)'],
      ['Lee', 'Sam', '9']
    ]
    const plan = planScoreImport(
      rows,
      true,
      false,
      detectScoreColumns(rows, true, false).mapping,
      twins,
      [],
      []
    )
    expect(plan.changes).toEqual([])
    expect(plan.problems[0].message).toMatch(/more than one student/)
  })

  it('uses an email column to tell twins apart', () => {
    const twins = [student(1, 'Sam', 'Lee', 'a@x.org'), student(2, 'Sam', 'Lee', 'b@x.org')]
    const rows = [
      ['Last', 'First', 'Email', 'Quiz (10)'],
      ['Lee', 'Sam', 'B@x.org', '9']
    ]
    const plan = planScoreImport(
      rows,
      true,
      false,
      detectScoreColumns(rows, true, false).mapping,
      twins,
      [],
      []
    )
    expect(plan.changes).toMatchObject([{ studentId: 2, points: 9 }])
  })

  it('skips the points row and blank rows', () => {
    const rows = [
      ['Name', 'Quiz'],
      ['Points Possible', '20'],
      ['Lovelace, Ada', '18'],
      ['', ''],
      ['Turing, Alan', '15']
    ]
    const r = [student(1, 'Ada', 'Lovelace'), student(2, 'Alan', 'Turing')]
    const plan = planScoreImport(
      rows,
      true,
      true,
      detectScoreColumns(rows, true, true).mapping,
      r,
      [],
      []
    )
    expect(plan.rows.map((x) => x.rowNumber)).toEqual([3, 5])
    expect(plan.changes.map((c) => c.points)).toEqual([18, 15])
  })
})

describe('export', () => {
  const cats: GradeCategory[] = [{ id: 1, classId: 1, name: 'Tests', weight: 100, sortOrder: 0 }]
  const students = [
    student(1, 'Priya', 'Abernathy', 'priya@example.org'),
    student(2, 'Tomas', 'Bellweather')
  ]
  const assignments = [asg(10, 'Quiz 1', 20, 1), asg(11, 'Essay', 50, 1)]
  const scores = [
    score(10, 1, 18),
    score(11, 1, null, 'missing'),
    score(10, 2, 9.5, 'late', 'handed in Tuesday'),
    score(11, 2, null, 'excused')
  ]

  it('has a header with points, numbers as numbers, M and EX markers and an average', () => {
    const rows = scoreExportRows('points', students, assignments, cats, scores)
    expect(rows[0]).toEqual([
      'Last name',
      'First name',
      'Email',
      'Quiz 1 (20)',
      'Essay (50)',
      'Average (%)'
    ])
    expect(rows[1]).toEqual(['Abernathy', 'Priya', 'priya@example.org', 18, 'M', round(18 / 70)])
    expect(rows[2]).toEqual(['Bellweather', 'Tomas', '', 9.5, 'EX', round(9.5 / 20)])
  })

  it('leaves the average empty when nothing is graded', () => {
    const rows = scoreExportRows('points', students, assignments, cats, [])
    expect(rows[1]).toEqual(['Abernathy', 'Priya', 'priya@example.org', '', '', ''])
  })

  it('lists flags and comments on a details sheet', () => {
    const rows = scoreDetailRows(students, assignments, scores)
    expect(rows).toHaveLength(4)
    expect(rows).toContainEqual([
      'Bellweather',
      'Tomas',
      'Quiz 1',
      9.5,
      'late',
      'handed in Tuesday'
    ])
  })

  it('round-trips: importing our own export changes nothing', () => {
    const rows = scoreExportRows('points', students, assignments, cats, scores).map((r) =>
      r.map(String)
    )
    const { mapping } = detectScoreColumns(rows, true, false)
    expect(mapping.columns.map((c) => [c.title, c.pointsPossible])).toEqual([
      ['Quiz 1', 20],
      ['Essay', 50]
    ])
    const plan = planScoreImport(rows, true, false, mapping, students, assignments, scores)
    expect(plan.problems).toEqual([])
    expect(plan.counts.scoresToWrite).toBe(0)
    expect(plan.counts.unchanged).toBe(4)
    expect(plan.counts.newAssignments).toBe(0)
  })
})

function round(fraction: number): number {
  return Math.round(fraction * 1000) / 10
}
