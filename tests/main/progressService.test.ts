import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectProgressColumns, type ProgressImportRequest } from '@shared/progressImport'
import { createProgressService } from '../../src/main/progressService'
import { createTokenStore } from '../../src/main/tokens'
import { readTable } from '../../src/main/tableIO'
import { makeEnv } from './helpers'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-progress-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const CSV = [
  'Last Name,First Name,Email,Course,Grade,Term,Source,As of',
  'Abernathy,Priya,priya@example.org,Algebra II,B+,Fall 2026,Westside HS,10/1/2026',
  'Bellweather,Tomas,,Studio Art,91,Fall 2026,Westside HS,',
  'Nobody,Here,,Art,A,,,'
].join('\n')

function setup() {
  const env = makeEnv()
  const tokens = createTokenStore()
  const svc = createProgressService(env.repos, tokens)
  const priya = env.repos.students.create({
    firstName: 'Priya',
    lastName: 'Abernathy',
    email: 'priya@example.org',
    tags: ['advisee']
  })
  const tomas = env.repos.students.create({
    firstName: 'Tomas',
    lastName: 'Bellweather',
    tags: ['advisee']
  })
  // In the vault, but not an advisee: never matched.
  const wren = env.repos.students.create({ firstName: 'Wren', lastName: 'Castellanos' })
  env.events.length = 0
  return { env, tokens, svc, priya, tomas, wren }
}

async function request(
  ctx: ReturnType<typeof setup>,
  text = CSV,
  over: Partial<ProgressImportRequest> = {}
): Promise<ProgressImportRequest> {
  const path = join(tmp(), 'outside.csv')
  writeFileSync(path, text)
  const table = await readTable(path)
  return {
    token: ctx.tokens.remember(path),
    hasHeader: true,
    mapping: detectProgressColumns(table.rows[0]),
    defaults: { term: '', source: '', recordedOn: null },
    ...over
  }
}

describe('progress import service', () => {
  it('previews without writing anything', async () => {
    const ctx = setup()
    const plan = await ctx.svc.previewImport(await request(ctx))
    expect(plan.counts).toMatchObject({ create: 2, unmatched: 1 })
    expect(ctx.env.repos.advising.progress(ctx.priya.id)).toEqual([])
    expect(ctx.env.events).toEqual([])
  })

  it('commits the entries and announces one change', async () => {
    const ctx = setup()
    const res = await ctx.svc.commitImport(await request(ctx))
    expect(res).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 1 })
    expect(ctx.env.repos.advising.progress(ctx.priya.id)[0]).toMatchObject({
      course: 'Algebra II',
      grade: 'B+',
      term: 'Fall 2026',
      source: 'Westside HS',
      recordedOn: '2026-10-01'
    })
    expect(ctx.env.repos.advising.progress(ctx.tomas.id)[0]).toMatchObject({ grade: '91' })
    expect(ctx.env.events.filter((e) => e.name === 'advising.changed')).toHaveLength(1)
  })

  it('is safe to repeat: the second import has nothing new to do', async () => {
    const ctx = setup()
    await ctx.svc.commitImport(await request(ctx))
    const again = await request(ctx)
    expect((await ctx.svc.previewImport(again)).counts).toMatchObject({
      create: 0,
      update: 0,
      unchanged: 2
    })
    await expect(ctx.svc.commitImport(again)).rejects.toThrow(/nothing new/)
    expect(ctx.env.repos.advising.progress(ctx.priya.id)).toHaveLength(1)
  })

  it('updates a grade that changed and keeps the entry id', async () => {
    const ctx = setup()
    await ctx.svc.commitImport(await request(ctx))
    const before = ctx.env.repos.advising.progress(ctx.priya.id)[0]
    const res = await ctx.svc.commitImport(await request(ctx, CSV.replace(',B+,', ',A-,')))
    expect(res).toMatchObject({ created: 0, updated: 1, unchanged: 1 })
    expect(ctx.env.repos.advising.progress(ctx.priya.id)).toEqual([{ ...before, grade: 'A-' }])
  })

  it('applies defaults to rows that leave a column out', async () => {
    const ctx = setup()
    const text = 'Student,Course,Grade\n"Bellweather, Tomas",Pottery,A'
    await ctx.svc.commitImport(
      await request(ctx, text, {
        defaults: { term: 'Spring 2026', source: 'Khan Academy', recordedOn: '2026-06-01' }
      })
    )
    expect(ctx.env.repos.advising.progress(ctx.tomas.id)[0]).toMatchObject({
      course: 'Pottery',
      term: 'Spring 2026',
      source: 'Khan Academy',
      recordedOn: '2026-06-01'
    })
  })

  it('never touches students who are not advisees', async () => {
    const ctx = setup()
    const text = 'Last,First,Course,Grade\nCastellanos,Wren,Art,A'
    const plan = await ctx.svc.previewImport(await request(ctx, text))
    expect(plan.rows[0]).toMatchObject({ action: 'unmatched' })
    await expect(ctx.svc.commitImport(await request(ctx, text))).rejects.toThrow(/nothing new/)
    expect(ctx.env.repos.advising.progress(ctx.wren.id)).toEqual([])
  })

  it('rejects bad requests with a readable message', async () => {
    const ctx = setup()
    const good = await request(ctx)
    const bad = (patch: Partial<ProgressImportRequest>) =>
      Promise.resolve().then(() => ctx.svc.previewImport({ ...good, ...patch }))
    await expect(bad({ token: 'nope' })).rejects.toThrow(/no longer open/)
    await expect(bad({ mapping: { ...good.mapping, course: null } })).rejects.toThrow(/course/)
    await expect(bad({ mapping: { ...good.mapping, grade: null } })).rejects.toThrow(/grade/)
    await expect(
      bad({
        mapping: { ...good.mapping, firstName: null, lastName: null, fullName: null, email: null }
      })
    ).rejects.toThrow(/identifies each student/)
    await expect(bad({ mapping: { ...good.mapping, course: -1 } })).rejects.toThrow(/Bad column/)
    await expect(bad({ defaults: { term: '', source: '', recordedOn: 'Oct 1' } })).rejects.toThrow(
      /date/
    )
    await expect(bad({ hasHeader: 'yes' as unknown as boolean })).rejects.toThrow(/true or false/)
  })

  it('does not write anything when a write fails part way', async () => {
    const ctx = setup()
    const req = await request(ctx)
    const original = ctx.env.repos.advising.createProgress
    let calls = 0
    ctx.env.repos.advising.createProgress = (input) => {
      if (++calls === 2) throw new Error('disk full')
      return original(input)
    }
    await expect(ctx.svc.commitImport(req)).rejects.toThrow(/disk full/)
    ctx.env.repos.advising.createProgress = original
    expect(ctx.env.repos.advising.progress(ctx.priya.id)).toEqual([])
    expect(ctx.env.events).toEqual([])
  })
})
