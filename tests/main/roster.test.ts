import ExcelJS from 'exceljs'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyMapping, guessMapping, type ImportRequest } from '@shared/roster'
import { createRosterService } from '../../src/main/rosterService'
import { readTable } from '../../src/main/tableIO'
import { makeEnv, seedClass } from './helpers'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-roster-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup(next: { open?: string | null; save?: string | null } = {}) {
  const env = makeEnv()
  let open = next.open ?? null
  let save = next.save ?? null
  const asked: { defaultName: string; format: string }[] = []
  const svc = createRosterService(env.repos, {
    pickOpenFile: async () => open,
    pickSaveFile: async (defaultName, format) => {
      asked.push({ defaultName, format })
      return save
    }
  })
  return {
    env,
    svc,
    asked,
    setOpen: (p: string | null) => (open = p),
    setSave: (p: string | null) => (save = p)
  }
}

const CSV =
  'Last Name,First Name,Email\nLovelace,Ada,ada@x.org\nTuring,Alan,alan@x.org\nHopper,Grace,\n'

function csvFile(text = CSV): string {
  const p = join(tmp(), 'roster.csv')
  writeFileSync(p, text)
  return p
}

async function request(
  svc: ReturnType<typeof setup>['svc'],
  target: ImportRequest['target']
): Promise<ImportRequest> {
  const file = (await svc.chooseFile())!
  return { token: file.token, hasHeader: true, mapping: guessMapping(file.rows[0]), target }
}

describe('roster import', () => {
  it('returns null when the picker is cancelled', async () => {
    expect(await setup({ open: null }).svc.chooseFile()).toBeNull()
  })

  it('reads the file and hands back a token instead of a path', async () => {
    const path = csvFile()
    const { svc } = setup({ open: path })
    const file = (await svc.chooseFile())!
    expect(file.fileName).toBe('roster.csv')
    expect(file.rows).toHaveLength(4)
    expect(JSON.stringify(file)).not.toContain(path)
  })

  it('previews without writing anything', async () => {
    const { env, svc } = setup({ open: csvFile() })
    const { cls } = seedClass(env, 0)
    const preview = await svc.preview(await request(svc, { classId: cls.id }))
    expect(preview.counts).toMatchObject({ total: 3, create: 3 })
    expect(env.repos.students.list()).toHaveLength(0)
  })

  it('commits into an existing class, emitting change events', async () => {
    const { env, svc } = setup({ open: csvFile() })
    const { cls } = seedClass(env, 0)
    const res = await svc.commit(await request(svc, { classId: cls.id }))
    expect(res).toEqual({ classId: cls.id, created: 3, enrolledExisting: 0, skipped: 0 })
    expect(env.repos.classes.roster(cls.id).map((s) => s.lastName)).toEqual([
      'Hopper',
      'Lovelace',
      'Turing'
    ])
    const names = env.events.map((e) => e.name)
    expect(names).toContain('students.changed')
    expect(names).toContain('enrollments.changed')
  })

  it('can create the class as part of the import', async () => {
    const { env, svc } = setup({ open: csvFile() })
    const term = env.repos.terms.create({ name: 'Fall 2026' })
    const res = await svc.commit(
      await request(svc, {
        newClass: { termId: term.id, course: 'Physics', section: 'B', gradingMode: 'weighted' }
      })
    )
    expect(env.repos.classes.get(res.classId)).toMatchObject({
      course: 'Physics',
      gradingMode: 'weighted'
    })
    expect(env.repos.classes.roster(res.classId)).toHaveLength(3)
  })

  it('is idempotent: importing the same file twice adds nobody', async () => {
    const { env, svc } = setup({ open: csvFile() })
    const { cls } = seedClass(env, 0)
    const req = await request(svc, { classId: cls.id })
    await svc.commit(req)
    await expect(svc.commit(req)).rejects.toThrow(/nothing new/)
    const preview = await svc.preview(req)
    expect(preview.counts).toMatchObject({ create: 0, alreadyEnrolled: 3 })
    expect(env.repos.students.list()).toHaveLength(3)
  })

  it('reuses students already in the database when adding them to a second class', async () => {
    const { env, svc } = setup({ open: csvFile() })
    const { cls, term } = seedClass(env, 0)
    await svc.commit(await request(svc, { classId: cls.id }))
    const second = env.repos.classes.create({
      termId: term.id,
      course: 'Other',
      gradingMode: 'points'
    })
    const res = await svc.commit(await request(svc, { classId: second.id }))
    expect(res).toMatchObject({ created: 0, enrolledExisting: 3 })
    expect(env.repos.students.list()).toHaveLength(3)
    expect(env.repos.classes.roster(second.id)).toHaveLength(3)
  })

  it('rolls everything back if the class disappears mid-way', async () => {
    const { env, svc } = setup({ open: csvFile() })
    const { cls } = seedClass(env, 0)
    const req = await request(svc, { classId: cls.id })
    env.repos.classes.delete(cls.id)
    await expect(svc.commit(req)).rejects.toThrow(/no longer exists/)
    expect(env.repos.students.list()).toHaveLength(0)
  })

  it('rolls back a new class if a student fails validation', async () => {
    const { env, svc } = setup({
      open: csvFile('Last,First,Notes\nSmith,Sam,ok\nJones,Jo,' + 'x'.repeat(6000) + '\n')
    })
    const term = env.repos.terms.create({ name: 'T' })
    const req = await request(svc, {
      newClass: { termId: term.id, course: 'C', gradingMode: 'points' }
    })
    await expect(svc.commit(req)).rejects.toThrow(/Notes is too long/)
    expect(env.repos.classes.list()).toHaveLength(0)
    expect(env.repos.students.list()).toHaveLength(0)
  })

  it('requires a name column and a valid mapping', async () => {
    const { env, svc } = setup({ open: csvFile() })
    const { cls } = seedClass(env, 0)
    const req = await request(svc, { classId: cls.id })
    await expect(svc.preview({ ...req, mapping: emptyMapping() })).rejects.toThrow(
      /column that holds student names/
    )
    await expect(svc.preview({ ...req, mapping: { ...req.mapping, email: -3 } })).rejects.toThrow(
      /Bad column/
    )
    await expect(svc.preview({ ...req, hasHeader: 'yes' as never })).rejects.toThrow(/hasHeader/)
  })

  it('rejects unknown tokens so a compromised renderer cannot read arbitrary paths', async () => {
    const { env, svc } = setup()
    const { cls } = seedClass(env, 0)
    await expect(
      svc.preview({
        token: '/etc/passwd',
        hasHeader: true,
        mapping: { ...emptyMapping(), lastName: 0 },
        target: { classId: cls.id }
      })
    ).rejects.toThrow(/no longer open/)
    await expect(svc.readSheet('nope', 'x')).rejects.toThrow(/no longer open/)
  })

  it('switches worksheets in an xlsx', async () => {
    const p = join(tmp(), 'multi.xlsx')
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Cover').addRow(['nothing here'])
    const r = wb.addWorksheet('Period 3')
    r.addRow(['Last', 'First'])
    r.addRow(['Lovelace', 'Ada'])
    await wb.xlsx.writeFile(p)
    const { svc } = setup({ open: p })
    const first = (await svc.chooseFile())!
    expect(first.sheetNames).toEqual(['Cover', 'Period 3'])
    const second = await svc.readSheet(first.token, 'Period 3')
    expect(second.rows[1]).toEqual(['Lovelace', 'Ada'])
  })
})

describe('roster export', () => {
  it('writes an xlsx that imports back to the same students', async () => {
    const out = join(tmp(), 'out.xlsx')
    const { env, svc, asked, setOpen } = setup({ save: out })
    const { cls, term } = seedClass(env, 3)
    env.repos.students.update(env.repos.classes.roster(cls.id)[0].id, {
      email: 'a@x.org',
      tags: ['advisee'],
      notes: 'PRIVATE'
    })
    const res = await svc.exportClass(cls.id, 'xlsx')
    expect(res).toEqual({ path: out })
    expect(asked[0]).toEqual({ defaultName: 'History Period 3 roster.xlsx', format: 'xlsx' })
    expect(JSON.stringify((await readTable(out)).rows)).not.toContain('PRIVATE')

    const fresh = env.repos.classes.create({
      termId: term.id,
      course: 'Copy',
      gradingMode: 'points'
    })
    // Everyone already exists, so a round-trip import should match all three and add none.
    setOpen(out)
    const res2 = await svc.commit(await request(svc, { classId: fresh.id }))
    expect(res2).toMatchObject({ created: 0, enrolledExisting: 3 })
    expect(env.repos.students.list()).toHaveLength(3)
  })

  it('round-trips through csv into an empty database', async () => {
    const out = join(tmp(), 'out.csv')
    const src = setup({ save: out })
    const { cls } = seedClass(src.env, 2)
    await src.svc.exportClass(cls.id, 'csv')

    const dst = setup({ open: out })
    const term = dst.env.repos.terms.create({ name: 'T' })
    const res = await dst.svc.commit(
      await request(dst.svc, {
        newClass: { termId: term.id, course: 'Copy', gradingMode: 'points' }
      })
    )
    expect(res.created).toBe(2)
    expect(dst.env.repos.classes.roster(res.classId).map((s) => s.lastName)).toEqual([
      'Last0',
      'Last1'
    ])
  })

  it('does nothing when the save dialog is cancelled', async () => {
    const { env, svc } = setup({ save: null })
    const { cls } = seedClass(env, 1)
    expect(await svc.exportClass(cls.id, 'xlsx')).toBeNull()
  })

  it('makes a safe default file name and validates input', async () => {
    const { env, svc, asked } = setup({ save: null })
    const term = env.repos.terms.create({ name: 'T' })
    const cls = env.repos.classes.create({
      termId: term.id,
      course: 'AP/US: History?',
      gradingMode: 'points'
    })
    await svc.exportClass(cls.id, 'csv')
    expect(asked[0].defaultName).toBe('AP US History roster.csv')
    await expect(svc.exportClass(cls.id, 'pdf' as never)).rejects.toThrow(/Format/)
    await expect(svc.exportClass(9999, 'csv')).rejects.toThrow(/no longer exists/)
    expect(existsSync('/nonexistent')).toBe(false)
  })
})
