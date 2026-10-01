import ExcelJS from 'exceljs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { computeStudentGrade } from '@shared/grades'
import { detectScoreColumns, type ScoreImportRequest } from '@shared/scoreImport'
import { createRosterService } from '../../src/main/rosterService'
import { createScoreService } from '../../src/main/scoreService'
import { readTable, writeWorkbook } from '../../src/main/tableIO'
import { makeEnv } from './helpers'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-score-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const CSV = [
  'Last Name,First Name,Student Email,Quiz 1 (20),Essay [50],Lab - 15 pts,Total',
  'Abernathy,Priya,priya@example.org,18,45,M,63',
  'Bellweather,Tomas,tomas@example.org,15.5,EX,12,27.5',
  'Castellanos,Wren,wren@example.org,20,50,15,85',
  'Nobody,Here,,5,5,5,15'
].join('\n')

function setup(open: string | null = null, save: string | null = null) {
  const env = makeEnv()
  const roster = createRosterService(env.repos, {
    pickOpenFile: async () => open,
    pickSaveFile: async () => save
  })
  const svc = createScoreService(env.repos, roster.tokens, { pickSaveFile: async () => save })
  const term = env.repos.terms.create({ name: 'T' })
  const cls = env.repos.classes.create({
    termId: term.id,
    course: 'Biology',
    period: '2',
    gradingMode: 'points'
  })
  const students = [
    env.repos.students.create({
      firstName: 'Priya',
      lastName: 'Abernathy',
      email: 'priya@example.org'
    }),
    env.repos.students.create({ firstName: 'Tomas', lastName: 'Bellweather' }),
    env.repos.students.create({
      firstName: 'Wren',
      lastName: 'Castellanos',
      email: 'wren@example.org'
    })
  ]
  for (const s of students) env.repos.classes.enroll(cls.id, s.id)
  env.events.length = 0
  return { env, roster, svc, cls, students, term }
}

async function request(
  ctx: ReturnType<typeof setup>,
  text = CSV,
  over: Partial<ScoreImportRequest> = {}
): Promise<ScoreImportRequest> {
  const dir = tmp()
  const path = join(dir, 'export.csv')
  writeFileSync(path, text)
  const token = ctx.roster.tokens.remember(path)
  const table = await readTable(path)
  return {
    token,
    hasHeader: true,
    pointsRow: false,
    classId: ctx.cls.id,
    mapping: detectScoreColumns(table.rows, true, false).mapping,
    ...over
  }
}

describe('score import', () => {
  it('creates assignments from the columns and writes every score', async () => {
    const ctx = setup()
    const req = await request(ctx)
    const preview = await ctx.svc.previewScores(req)
    expect(preview.counts).toMatchObject({
      matchedStudents: 3,
      unmatchedStudents: 1,
      newAssignments: 3
    })
    expect(ctx.env.repos.grading.assignments(ctx.cls.id)).toHaveLength(0) // preview writes nothing

    const res = await ctx.svc.commitScores(req)
    expect(res).toEqual({
      createdAssignments: 3,
      scoresWritten: 9,
      unchanged: 0,
      skippedRows: 1,
      invalidCells: 0
    })
    const asg = ctx.env.repos.grading.assignments(ctx.cls.id)
    expect(asg.map((a) => [a.title, a.pointsPossible])).toEqual([
      ['Quiz 1', 20],
      ['Essay', 50],
      ['Lab', 15]
    ])
    const scores = ctx.env.repos.grading.scores(ctx.cls.id)
    expect(scores).toHaveLength(9) // 3 students x 3 columns; no cell is blank, and EX and M are stored
    expect(
      scores.find((s) => s.studentId === ctx.students[0].id && s.assignmentId === asg[2].id)
    ).toMatchObject({ points: null, status: 'missing' })
    expect(
      scores.find((s) => s.studentId === ctx.students[1].id && s.assignmentId === asg[1].id)
    ).toMatchObject({ points: null, status: 'excused' })
  })

  it('produces grades that can be checked by hand', async () => {
    const ctx = setup()
    await ctx.svc.commitScores(await request(ctx))
    const asg = ctx.env.repos.grading.assignments(ctx.cls.id)
    const scores = ctx.env.repos.grading.scores(ctx.cls.id)
    const gradeFor = (i: number) =>
      computeStudentGrade(
        'points',
        asg,
        [],
        new Map(
          scores.filter((s) => s.studentId === ctx.students[i].id).map((s) => [s.assignmentId, s])
        )
      ).percent
    // Priya: 18 + 45 + (missing = 0) over 20 + 50 + 15 = 63/85
    expect(gradeFor(0)).toBeCloseTo((63 / 85) * 100, 6)
    // Tomas: essay excused, so 15.5 + 12 over 20 + 15 = 27.5/35
    expect(gradeFor(1)).toBeCloseTo((27.5 / 35) * 100, 6)
    // Wren: 85/85
    expect(gradeFor(2)).toBe(100)
  })

  it('broadcasts only after the import has committed', async () => {
    const ctx = setup()
    const seen: boolean[] = []
    const original = ctx.env.events.push.bind(ctx.env.events)
    ctx.env.events.push = (...e) => {
      seen.push(ctx.env.db.inTransaction)
      return original(...e)
    }
    await ctx.svc.commitScores(await request(ctx))
    expect(ctx.env.events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['assignments.changed', 'scores.changed'])
    )
    expect(seen.every((inTx) => !inTx)).toBe(true)
  })

  it('is idempotent: a second import has nothing to do', async () => {
    const ctx = setup()
    const req = await request(ctx)
    await ctx.svc.commitScores(req)
    const preview = await ctx.svc.previewScores(req)
    expect(preview.counts).toMatchObject({
      scoresToWrite: 0,
      unchanged: 9,
      newAssignments: 0,
      existingAssignments: 3
    })
    await expect(ctx.svc.commitScores(req)).rejects.toThrow(/nothing new/)
    expect(ctx.env.repos.grading.assignments(ctx.cls.id)).toHaveLength(3)
  })

  it('updates changed scores in place and keeps comments and late flags', async () => {
    const ctx = setup()
    const req = await request(ctx)
    await ctx.svc.commitScores(req)
    const [quiz] = ctx.env.repos.grading.assignments(ctx.cls.id)
    ctx.env.repos.grading.setScore({
      assignmentId: quiz.id,
      studentId: ctx.students[0].id,
      points: 18,
      status: 'late',
      comment: 'turned in Tuesday'
    })
    // The school export now says Priya got 19 on the quiz.
    const updated = await request(
      ctx,
      CSV.replace('priya@example.org,18,', 'priya@example.org,19,')
    )
    const res = await ctx.svc.commitScores(updated)
    expect(res).toMatchObject({ createdAssignments: 0, scoresWritten: 1 })
    expect(
      ctx.env.repos.grading
        .scores(ctx.cls.id)
        .find((s) => s.assignmentId === quiz.id && s.studentId === ctx.students[0].id)
    ).toMatchObject({
      points: 19,
      status: 'late',
      comment: 'turned in Tuesday'
    })
  })

  it('rolls everything back if a new assignment cannot be created', async () => {
    const ctx = setup()
    const other = ctx.env.repos.classes.create({
      termId: ctx.term.id,
      course: 'Other',
      gradingMode: 'weighted'
    })
    const foreign = ctx.env.repos.grading.createCategory({
      classId: other.id,
      name: 'X',
      weight: 10
    })
    const req = await request(ctx)
    req.mapping.columns[2].categoryId = foreign.id // the third column's category belongs to another class
    await expect(ctx.svc.commitScores(req)).rejects.toThrow(/different class/)
    expect(ctx.env.repos.grading.assignments(ctx.cls.id)).toHaveLength(0)
    expect(ctx.env.repos.grading.scores(ctx.cls.id)).toHaveLength(0)
  })

  it('uses the category chosen for a new assignment', async () => {
    const ctx = setup()
    const cat = ctx.env.repos.grading.createCategory({
      classId: ctx.cls.id,
      name: 'Tests',
      weight: 50
    })
    const req = await request(ctx)
    req.mapping.columns[0].categoryId = cat.id
    await ctx.svc.commitScores(req)
    expect(ctx.env.repos.grading.assignments(ctx.cls.id)[0].categoryId).toBe(cat.id)
  })

  it('reports invalid cells without blocking the rest', async () => {
    const ctx = setup()
    const req = await request(ctx, CSV.replace(',18,45,M,', ',85%,45,M,'))
    const res = await ctx.svc.commitScores(req)
    expect(res.invalidCells).toBe(1)
    expect(res.scoresWritten).toBe(8)
  })

  it('validates the request', async () => {
    const ctx = setup()
    const req = await request(ctx)
    await expect(ctx.svc.previewScores({ ...req, token: 'nope' })).rejects.toThrow(/no longer open/)
    await expect(ctx.svc.previewScores({ ...req, classId: 9999 })).rejects.toThrow(
      /no longer exists/
    )
    await expect(
      ctx.svc.previewScores({ ...req, mapping: { ...req.mapping, columns: [] } })
    ).rejects.toThrow(/at least one column/)
    await expect(
      ctx.svc.previewScores({
        ...req,
        mapping: { ...req.mapping, firstName: null, lastName: null, fullName: null, email: null }
      })
    ).rejects.toThrow(/identifies each student/)
    const dup = {
      ...req,
      mapping: {
        ...req.mapping,
        columns: [req.mapping.columns[0], { ...req.mapping.columns[1], title: ' quiz  1 ' }]
      }
    }
    await expect(ctx.svc.previewScores(dup)).rejects.toThrow(/both called/)
    const neg = {
      ...req,
      mapping: { ...req.mapping, columns: [{ ...req.mapping.columns[0], pointsPossible: -1 }] }
    }
    await expect(ctx.svc.previewScores(neg)).rejects.toThrow(/at least 0/)
    await expect(ctx.svc.previewScores({ ...req, hasHeader: 'yes' as never })).rejects.toThrow(
      /true or false/
    )
  })

  it('reads an xlsx with a points-possible row', async () => {
    const ctx = setup()
    const path = join(tmp(), 'g.xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Grades')
    ws.addRow(['Student', 'Quiz 1', 'Essay', 'Average'])
    ws.addRow(['Points Possible', 20, 50, ''])
    ws.addRow(['Abernathy, Priya', 18, 40, 90])
    await wb.xlsx.writeFile(path)
    const token = ctx.roster.tokens.remember(path)
    const table = await readTable(path)
    const mapping = detectScoreColumns(table.rows, true, true).mapping
    const res = await ctx.svc.commitScores({
      token,
      hasHeader: true,
      pointsRow: true,
      classId: ctx.cls.id,
      mapping
    })
    expect(res).toMatchObject({ createdAssignments: 2, scoresWritten: 2 })
    expect(ctx.env.repos.grading.assignments(ctx.cls.id).map((a) => a.pointsPossible)).toEqual([
      20, 50
    ])
  })
})

describe('score export', () => {
  async function graded() {
    const out = join(tmp(), 'out')
    const ctx = setup(null, `${out}.xlsx`)
    await ctx.svc.commitScores(await request(ctx))
    const [quiz] = ctx.env.repos.grading.assignments(ctx.cls.id)
    ctx.env.repos.grading.setScore({
      assignmentId: quiz.id,
      studentId: ctx.students[1].id,
      points: 15.5,
      status: 'late',
      comment: 'handed in Tuesday'
    })
    return { ctx, out }
  }

  it('writes a Scores sheet with numeric points, M and EX, plus a Details sheet for flags and comments', async () => {
    const { ctx, out } = await graded()
    const res = await ctx.svc.exportClass(ctx.cls.id, 'xlsx')
    expect(res).toEqual({ path: `${out}.xlsx` })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(`${out}.xlsx`)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Scores', 'Details'])
    const scores = wb.getWorksheet('Scores')!
    expect(scores.getRow(1).values).toEqual([
      undefined,
      'Last name',
      'First name',
      'Email',
      'Quiz 1 (20)',
      'Essay (50)',
      'Lab (15)',
      'Average (%)'
    ])
    expect(typeof scores.getCell('D2').value).toBe('number')
    expect(scores.getCell('F2').value).toBe('M')
    expect(scores.getCell('E3').value).toBe('EX')
    const details = wb.getWorksheet('Details')!
    const text = JSON.stringify(details.getSheetValues())
    expect(text).toContain('handed in Tuesday')
    expect(text).toContain('missing')
  })

  it('writes a csv with only the scores', async () => {
    const out = join(tmp(), 'g.csv')
    const ctx = setup(null, out)
    await ctx.svc.commitScores(await request(ctx))
    await ctx.svc.exportClass(ctx.cls.id, 'csv')
    const t = await readTable(out)
    expect(t.rows[0]).toContain('Quiz 1 (20)')
    expect(t.rows).toHaveLength(4)
  })

  it('round-trips: importing our own export finds nothing to change', async () => {
    const { ctx, out } = await graded()
    await ctx.svc.exportClass(ctx.cls.id, 'xlsx')
    const path = `${out}.xlsx`
    const token = ctx.roster.tokens.remember(path)
    const table = await readTable(path, 'Scores')
    const mapping = detectScoreColumns(table.rows, true, false).mapping
    const req = {
      token,
      sheet: 'Scores',
      hasHeader: true,
      pointsRow: false,
      classId: ctx.cls.id,
      mapping
    }
    const preview = await ctx.svc.previewScores(req)
    expect(preview.problems).toEqual([])
    expect(preview.counts).toMatchObject({ scoresToWrite: 0, newAssignments: 0 })
    await expect(ctx.svc.commitScores(req)).rejects.toThrow(/nothing new/)
  })

  it('does nothing when the save dialog is cancelled, and validates input', async () => {
    const ctx = setup(null, null)
    expect(await ctx.svc.exportClass(ctx.cls.id, 'xlsx')).toBeNull()
    await expect(ctx.svc.exportClass(9999, 'xlsx')).rejects.toThrow(/no longer exists/)
    await expect(ctx.svc.exportClass(ctx.cls.id, 'pdf' as never)).rejects.toThrow(/Format/)
  })

  it('neutralises spreadsheet formulas in names', async () => {
    const out = join(tmp(), 'f.xlsx')
    const ctx = setup(null, out)
    ctx.env.repos.students.create({ firstName: '=HYPERLINK("x")', lastName: 'Evil' })
    const evil = ctx.env.repos.students.list({ search: 'Evil' })[0]
    ctx.env.repos.classes.enroll(ctx.cls.id, evil.id)
    await ctx.svc.exportClass(ctx.cls.id, 'xlsx')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(out)
    const values = JSON.stringify(wb.getWorksheet('Scores')!.getSheetValues())
    expect(values).toContain(`'=HYPERLINK`)
    expect(values).not.toContain('"=HYPERLINK')
  })
})

describe('writeWorkbook', () => {
  it('keeps sheet names unique and valid', async () => {
    const out = join(tmp(), 'w.xlsx')
    await writeWorkbook(out, [
      { name: 'Data', rows: [['a']] },
      { name: 'data', rows: [['b']] },
      { name: 'x/y', rows: [['c']] }
    ])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(out)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Data', 'data 2', 'x y'])
  })
})
