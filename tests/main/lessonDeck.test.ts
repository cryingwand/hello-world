import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import type { LessonInput } from '@shared/api'
import type { UnitDetail } from '@shared/models'
import { lessonDeck } from '../../src/main/lessonDeck'
import { createLessonService } from '../../src/main/lessonService'
import { makeEnv, type TestEnv } from './helpers'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** The text of each run on a slide, in order. Slide-number fields are not runs, so they are left out. */
const runsOf = (xml: string): string[] =>
  [...xml.matchAll(/<a:r>[\s\S]*?<a:t>([^<]*)<\/a:t><\/a:r>/g)].map((m) => decode(m[1]))

interface Parsed {
  /** Each slide's text, in order, without the footer line. */
  slides: string[][]
  notes: string[]
  xml: string[]
  zip: JSZip
}

async function open(unit: UnitDetail, lessonId: number | null = null): Promise<Parsed> {
  const zip = await JSZip.loadAsync(await lessonDeck(unit, lessonId))
  const count = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length
  const xml: string[] = []
  const notes: string[] = []
  for (let i = 1; i <= count; i++) {
    xml.push(await zip.file(`ppt/slides/slide${i}.xml`)!.async('string'))
    const n = await zip.file(`ppt/notesSlides/notesSlide${i}.xml`)!.async('string')
    const body = /<p:ph type="body"[\s\S]*?<\/p:sp>/.exec(n)?.[0] ?? ''
    notes.push(runsOf(body).join('\n'))
  }
  const footer = [unit.course, unit.title].filter((p) => p.trim() !== '').join(' • ')
  // The footer is the first run on every slide but a unit deck's title slide, which has none.
  const slides = xml.map((x, i) => {
    const runs = runsOf(x)
    const hasFooter = !(lessonId === null && i === 0)
    return hasFooter && runs[0] === footer ? runs.slice(1) : runs
  })
  return { slides, notes, xml, zip }
}

function fixture(env: TestEnv) {
  const unit = env.repos.units.create({
    title: 'Ethics',
    course: 'PHIL 101',
    summary: 'Big ideas'
  })
  const quiz = env.repos.quizzes.create({ title: 'Quiz 1', date: '2026-10-09' })
  const day1 = env.repos.lessons.create({
    unitId: unit.id,
    title: 'Day 1',
    date: '2026-10-02',
    objectives: 'Define ethics',
    plan: 'Warm-up\nLecture',
    homework: 'Read',
    notes: 'SECRET'
  })
  env.repos.lessons.create({ unitId: unit.id, title: 'Day 2' })
  env.repos.lessons.linkQuiz(day1.id, quiz.id)
  return { unit: env.repos.units.get(unit.id)!, day1, quiz }
}

function oneLesson(
  env: TestEnv,
  lesson: Partial<LessonInput>,
  unit: { title?: string; course?: string; summary?: string } = {}
) {
  const u = env.repos.units.create({ title: 'U', ...unit })
  env.repos.lessons.create({ unitId: u.id, title: 'L', ...lesson })
  return env.repos.units.get(u.id)!
}

describe('lessonDeck', () => {
  it('lays a unit out as title, overview, lesson list, then each lesson', async () => {
    const env = makeEnv()
    const { unit } = fixture(env)
    const { slides } = await open(unit)
    expect(slides).toEqual([
      ['Ethics', 'PHIL 101 • October 2, 2026'],
      ['Ethics', 'Overview', 'Big ideas'],
      ['Ethics', 'Lessons', 'Day 1 — October 2, 2026', 'Day 2'],
      ['Day 1', 'October 2, 2026 • Objectives', 'Define ethics'],
      ['Day 1', 'Plan', 'Warm-up', 'Lecture'],
      ['Day 1', 'Homework', 'Read'],
      ['Day 1', 'Quizzes and exams', 'Quiz: Quiz 1 (October 9, 2026)'],
      ['Day 2']
    ])
  })

  it('puts the lesson notes on that lesson’s slides only, as speaker notes', async () => {
    const env = makeEnv()
    const { unit } = fixture(env)
    const { notes, xml } = await open(unit)
    expect(notes).toEqual(['', '', '', 'SECRET', 'SECRET', 'SECRET', 'SECRET', ''])
    for (const x of xml) expect(x).not.toContain('SECRET')
  })

  it('writes a single lesson without the unit title, overview or list', async () => {
    const env = makeEnv()
    const { unit, day1 } = fixture(env)
    const { slides, notes } = await open(unit, day1.id)
    expect(slides.map((s) => s[1])).toEqual([
      'October 2, 2026 • Objectives',
      'Plan',
      'Homework',
      'Quizzes and exams'
    ])
    expect(notes.every((n) => n === 'SECRET')).toBe(true)
  })

  it('says where a lone lesson belongs in the footer of each slide', async () => {
    const env = makeEnv()
    const { unit, day1 } = fixture(env)
    const { xml } = await open(unit, day1.id)
    for (const x of xml) expect(runsOf(x)).toContain('PHIL 101 • Ethics')
  })

  it('refuses a lesson that is not in the unit', async () => {
    const env = makeEnv()
    const { unit } = fixture(env)
    await expect(lessonDeck(unit, 9999)).rejects.toThrow(/not in this unit/)
  })

  it('leaves out an overview and a lesson list that would say nothing', async () => {
    const env = makeEnv()
    const unit = oneLesson(env, { title: 'Only', plan: 'Do it' })
    const { slides } = await open(unit)
    expect(slides).toEqual([['U'], ['Only'], ['Only', 'Plan', 'Do it']])
  })

  it('gives a lesson with nothing written a slide of its own', async () => {
    const env = makeEnv()
    const { slides } = await open(oneLesson(env, { title: 'Bare' }))
    expect(slides[1]).toEqual(['Bare'])
  })

  it('shows the span of the unit on the title slide, and only what it knows', async () => {
    const env = makeEnv()
    const u = env.repos.units.create({ title: 'Span', course: 'BIO' })
    env.repos.lessons.create({ unitId: u.id, title: 'B', date: '2026-10-16' })
    env.repos.lessons.create({ unitId: u.id, title: 'A', date: '2026-10-02' })
    env.repos.lessons.create({ unitId: u.id, title: 'Undated' })
    expect((await open(env.repos.units.get(u.id)!)).slides[0]).toEqual([
      'Span',
      'BIO • October 2, 2026 – October 16, 2026'
    ])

    const bare = env.repos.units.create({ title: 'Bare' })
    env.repos.lessons.create({ unitId: bare.id, title: 'L' })
    expect((await open(env.repos.units.get(bare.id)!)).slides[0]).toEqual(['Bare'])
  })

  it('drops list markers the teacher typed, so a bullet is not shown twice', async () => {
    const env = makeEnv()
    const { slides } = await open(oneLesson(env, { plan: '- Warm-up\n1. Lecture\n\n  • Exit' }))
    expect(slides[2]).toEqual(['L', 'Plan', 'Warm-up', 'Lecture', 'Exit'])
  })

  it('continues a long list on more slides instead of running off the bottom', async () => {
    const env = makeEnv()
    const steps = Array.from({ length: 20 }, (_, i) => `Step ${i + 1}`)
    const { slides } = await open(oneLesson(env, { plan: steps.join('\n') }))
    const plan = slides.filter((s) => s[1]?.startsWith('Plan'))
    expect(plan.map((s) => s[1])).toEqual(['Plan (1 of 3)', 'Plan (2 of 3)', 'Plan (3 of 3)'])
    expect(plan.flatMap((s) => s.slice(2))).toEqual(steps)
    for (const s of plan) expect(s.length - 2).toBeLessThanOrEqual(7)
  })

  it('counts a long step as more than one line when it fills a slide', async () => {
    const env = makeEnv()
    const long = 'word '.repeat(40).trim() // 199 characters: wraps onto four lines
    const { slides } = await open(oneLesson(env, { plan: [long, long, 'a', 'b'].join('\n') }))
    const plan = slides.filter((s) => s[1]?.startsWith('Plan'))
    expect(plan.length).toBeGreaterThan(1)
    expect(plan.flatMap((s) => s.slice(2))).toEqual([long, long, 'a', 'b'])
  })

  it('writes text with markup characters safely', async () => {
    const env = makeEnv()
    const unit = oneLesson(env, { title: 'Rock & Roll <3', plan: 'a < b && "c"' }, { title: 'Q&A' })
    const { slides } = await open(unit)
    expect(slides[0][0]).toBe('Q&A')
    expect(slides[1][0]).toBe('Rock & Roll <3')
    expect(slides[2].slice(2)).toEqual(['a < b && "c"'])
  })

  it('uses Palatino Linotype for every run, like the Word documents', async () => {
    const env = makeEnv()
    const { unit } = fixture(env)
    const { xml } = await open(unit)
    for (const x of xml) {
      const faces = [...x.matchAll(/<a:latin typeface="([^"]+)"/g)].map((m) => m[1])
      expect(faces.length).toBeGreaterThan(0)
      expect(new Set(faces)).toEqual(new Set(['Palatino Linotype']))
    }
  })

  it('writes only the titles of quizzes, never their questions or answers', async () => {
    const env = makeEnv()
    const { unit, quiz } = fixture(env)
    const q = env.repos.questions.create({
      kind: 'short-answer',
      prompt: 'TOP SECRET QUESTION',
      answer: 'TOP SECRET ANSWER'
    })
    env.repos.quizzes.addQuestions(quiz.id, [q.id])
    const { zip } = await open(env.repos.units.get(unit.id)!)
    for (const name of Object.keys(zip.files).filter((f) => f.endsWith('.xml'))) {
      const text = await zip.file(name)!.async('string')
      expect(text, name).not.toContain('TOP SECRET')
    }
  })

  it('names the unit in the file properties and leaves the author blank', async () => {
    const env = makeEnv()
    const { unit, day1 } = fixture(env)
    const core = await (await open(unit)).zip.file('docProps/core.xml')!.async('string')
    expect(core).toContain('<dc:title>Ethics</dc:title>')
    expect(core).toContain('<dc:creator></dc:creator>')
    const one = await (await open(unit, day1.id)).zip.file('docProps/core.xml')!.async('string')
    expect(one).toContain('<dc:title>Day 1</dc:title>')
  })

  it('is a real 16:9 presentation', async () => {
    const env = makeEnv()
    const { zip } = await open(fixture(env).unit)
    const pres = await zip.file('ppt/presentation.xml')!.async('string')
    expect(pres).toMatch(/<p:sldSz cx="9144000" cy="5143500"/)
  })
})

describe('lessonService', () => {
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'tos-deck-'))
    dirs.push(d)
    return d
  }
  function service(pick: (name: string) => Promise<string | null>) {
    const env = makeEnv()
    const made = fixture(env)
    const svc = createLessonService(env.repos, { pickSaveFile: pick, today: () => '2026-10-01' })
    return { env, ...made, svc }
  }

  it('suggests a dated name, asks where to save, and writes a real PowerPoint file', async () => {
    const dir = tmp()
    let suggested = ''
    const { unit, svc } = service(async (name) => {
      suggested = name
      return join(dir, name)
    })
    const res = await svc.exportPowerPoint(unit.id)
    expect(suggested).toBe('2026-10-01 PHIL 101 Ethics.pptx')
    expect(res).toEqual({ path: join(dir, suggested) })
    const zip = await JSZip.loadAsync(readFileSync(res!.path))
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull()
  })

  it('names a single lesson in the file, and adds .pptx when the chosen name has none', async () => {
    const dir = tmp()
    let suggested = ''
    const { unit, day1, svc } = service(async (name) => {
      suggested = name
      return join(dir, 'my deck')
    })
    const res = await svc.exportPowerPoint(unit.id, day1.id)
    expect(suggested).toBe('2026-10-01 PHIL 101 Ethics Day 1.pptx')
    expect(res!.path).toBe(join(dir, 'my deck.pptx'))
    expect(readdirSync(dir)).toEqual(['my deck.pptx'])
  })

  it('writes nothing when the save is cancelled', async () => {
    const dir = tmp()
    const { unit, svc } = service(async () => null)
    expect(await svc.exportPowerPoint(unit.id)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('keeps characters a file name cannot hold out of the suggestion', async () => {
    let suggested = ''
    const env = makeEnv()
    const unit = oneLesson(env, { title: 'Day: 1?' }, { title: 'A/B', course: 'X\\Y' })
    const svc = createLessonService(env.repos, {
      pickSaveFile: async (name) => {
        suggested = name
        return null
      },
      today: () => '2026-10-01'
    })
    await svc.exportPowerPoint(unit.id, unit.lessons[0].id)
    expect(suggested).toBe('2026-10-01 X Y A B Day 1.pptx')
  })

  it('refuses what cannot be exported, with a message the teacher can read', async () => {
    const { env, unit, svc } = service(async () => '/never')
    const empty = env.repos.units.create({ title: 'Empty' })
    await expect(svc.exportPowerPoint(empty.id)).rejects.toThrow(/Add a lesson first/)
    await expect(svc.exportPowerPoint(9999)).rejects.toThrow(/no longer exists/)
    const other = oneLesson(env, {})
    await expect(svc.exportPowerPoint(unit.id, other.lessons[0].id)).rejects.toThrow(
      /not in this unit/
    )
    await expect(svc.exportPowerPoint('x' as unknown as number)).rejects.toThrow(/valid id/)
    await expect(svc.exportPowerPoint(unit.id, 'x' as unknown as number)).rejects.toThrow(
      /valid id/
    )
  })
})

describe('what a deck leaves out', () => {
  it('never mentions the classes or Gradebook assignments a lesson is linked to', async () => {
    const env = makeEnv()
    const term = env.repos.terms.create({ name: 'Fall 2026' })
    const cls = env.repos.classes.create({
      termId: term.id,
      course: 'Secret Section Alpha',
      gradingMode: 'points'
    })
    const hw = env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'Hidden Homework Title',
      pointsPossible: 5
    })
    const unit = env.repos.units.create({ title: 'Ethics' })
    const lesson = env.repos.lessons.create({ unitId: unit.id, title: 'Day 1', plan: 'Discuss' })
    env.repos.lessons.linkClass(lesson.id, cls.id)
    env.repos.lessons.linkAssignment(lesson.id, hw.id)
    const zip = await JSZip.loadAsync(await lessonDeck(env.repos.units.get(unit.id)!, null))
    let all = ''
    for (const name of Object.keys(zip.files)) {
      if (!zip.files[name].dir) all += await zip.files[name].async('string')
    }
    expect(all).toContain('Discuss')
    expect(all).not.toContain('Secret Section Alpha')
    expect(all).not.toContain('Hidden Homework Title')
  })
})
