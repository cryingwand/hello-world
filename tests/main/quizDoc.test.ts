import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { afterEach, describe, expect, it } from 'vitest'
import type { QuestionInput } from '@shared/api'
import type { QuizDetail } from '@shared/models'
import { quizDocx } from '../../src/main/quizDoc'
import { createQuizService } from '../../src/main/quizService'
import { makeEnv, type TestEnv } from './helpers'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function quizWith(
  env: TestEnv,
  questions: QuestionInput[],
  quiz: { title?: string; course?: string; date?: string | null; instructions?: string } = {}
): QuizDetail {
  const made = env.repos.quizzes.create({
    title: 'Quiz 3',
    course: 'PHIL 101',
    date: '2026-10-02',
    ...quiz
  })
  const ids = questions.map((q) => env.repos.questions.create(q).id)
  return env.repos.quizzes.addQuestions(made.id, ids)
}

const choice = (prompt: string, correctChoice = 1, extra: Partial<QuestionInput> = {}) =>
  ({
    kind: 'multiple-choice',
    prompt,
    choices: ['alpha', 'beta', 'gamma', 'delta'],
    correctChoice,
    ...extra
  }) as QuestionInput

interface Parsed {
  xml: string
  numbering: string
  paragraphs: { xml: string; text: string }[]
}

async function open(quiz: QuizDetail, version: 'student' | 'key'): Promise<Parsed> {
  const zip = await JSZip.loadAsync(await quizDocx(quiz, version))
  const xml = await zip.file('word/document.xml')!.async('string')
  const numbering = await zip.file('word/numbering.xml')!.async('string')
  const paragraphs = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => ({
    xml: p,
    text: [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
  }))
  return { xml, numbering, paragraphs }
}

const numIdOf = (p: { xml: string }): string | null =>
  /<w:numId w:val="(\d+)"\/>/.exec(p.xml)?.[1] ?? null

describe('quiz Word document: house style', () => {
  it('sets every run in Palatino Linotype 12pt on a Letter page with the house margins', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [
      choice('First?'),
      { kind: 'short-answer', prompt: 'Second?' },
      { kind: 'essay', prompt: 'Third?' }
    ])
    for (const version of ['student', 'key'] as const) {
      const { xml, numbering } = await open(quiz, version)
      const fonts = [...xml.matchAll(/<w:rFonts [^>]*w:ascii="([^"]*)"/g)].map((m) => m[1])
      expect(fonts.length).toBeGreaterThan(0)
      expect(new Set(fonts)).toEqual(new Set(['Palatino Linotype']))
      const sizes = [...xml.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map((m) => m[1])
      expect(new Set(sizes)).toEqual(new Set(['24']))
      expect(/<w:pgSz [^>]*w:w="12240"[^>]*w:h="15840"/.test(xml)).toBe(true)
      const margin = /<w:pgMar ([^>]*)\/>/.exec(xml)![1]
      expect(margin).toMatch(/w:top="1080"/)
      expect(margin).toMatch(/w:bottom="1080"/)
      expect(margin).toMatch(/w:left="720"/)
      expect(margin).toMatch(/w:right="720"/)
      // The number and letter of each list item are Palatino 12pt too.
      expect(numbering).toMatch(/Palatino Linotype/)
    }
  })

  it('opens with one centered bold line: Course • Title • Date', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [choice('First?')])
    const { paragraphs } = await open(quiz, 'student')
    expect(paragraphs[0].text).toBe('PHIL 101 • Quiz 3 • October 2, 2026')
    expect(paragraphs[0].xml).toMatch(/<w:jc w:val="center"\/>/)
    expect(paragraphs[0].xml).toMatch(/<w:b\/>/)
    expect(paragraphs[1].text).toBe('First?')
  })

  it('leaves blank header pieces out, and labels the answer key', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [choice('First?')], { course: '', date: null })
    expect((await open(quiz, 'student')).paragraphs[0].text).toBe('Quiz 3')
    expect((await open(quiz, 'key')).paragraphs[0].text).toBe('Quiz 3 (Answer Key)')
  })

  it('keeps instructions as plain paragraphs under the header, skipping blank lines', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [choice('First?')], {
      instructions: 'Answer every question.\n\nNo notes.'
    })
    const { paragraphs } = await open(quiz, 'student')
    expect(paragraphs.slice(1, 3).map((p) => p.text)).toEqual([
      'Answer every question.',
      'No notes.'
    ])
    expect(paragraphs[1].xml).not.toMatch(/<w:numPr>/)
  })

  it('numbers questions with one Word list and restarts the letters for every question', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [
      choice('First?'),
      { kind: 'true-false', prompt: 'Second?', correctChoice: 0 },
      choice('Third?')
    ])
    const { paragraphs, numbering } = await open(quiz, 'student')
    const questions = paragraphs.filter((p) => /^(First|Second|Third)\?$/.test(p.text))
    expect(questions).toHaveLength(3)
    expect(new Set(questions.map(numIdOf)).size).toBe(1) // one list, so 1. 2. 3.
    const options = paragraphs.filter((p) =>
      ['alpha', 'beta', 'gamma', 'delta', 'True', 'False'].includes(p.text)
    )
    expect(options).toHaveLength(10)
    // Three questions with choices -> three separate lists -> three separate Word numbers.
    expect(new Set(options.map(numIdOf)).size).toBe(3)
    expect(numIdOf(options[0])).not.toBe(numIdOf(questions[0]))
    expect(numbering).toMatch(/w:numFmt w:val="lowerLetter"/)
    expect(numbering).toMatch(/w:numFmt w:val="decimal"/)
    // No typed numbers or letters: Word supplies them.
    for (const p of paragraphs) expect(p.text).not.toMatch(/^(\d+|[a-f])[.)]\s/)
  })

  it('keeps a question and its choices together, with a gap only after the last choice', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [choice('First?'), choice('Second?')])
    const { paragraphs } = await open(quiz, 'student')
    const first = paragraphs.findIndex((p) => p.text === 'First?')
    const block = paragraphs.slice(first, first + 5) // prompt + four choices
    expect(block.map((p) => p.text)).toEqual(['First?', 'alpha', 'beta', 'gamma', 'delta'])
    for (const p of block) expect(p.xml).toMatch(/<w:keepLines\/>/)
    for (const p of block.slice(0, 4)) expect(p.xml).toMatch(/<w:keepNext\/>/)
    expect(block[4].xml).not.toMatch(/<w:keepNext\/>/)
    for (const p of block.slice(0, 4)) expect(p.xml).toMatch(/w:after="0"/)
    expect(block[4].xml).toMatch(/w:after="200"/)
  })

  it('writes ruled lines for the student copy of written questions', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [
      { kind: 'short-answer', prompt: 'Short?', answer: 'Because.' },
      { kind: 'essay', prompt: 'Long?' }
    ])
    const student = await open(quiz, 'student')
    const ruled = student.paragraphs.filter((p) => /w:leader="underscore"/.test(p.xml))
    expect(ruled).toHaveLength(3 + 8)
    expect(student.xml).not.toMatch(/Because\./) // the model answer is never on the student copy
    expect(student.xml).not.toMatch(/Answer: /)
  })

  it('prints points unless every question is worth one', async () => {
    const env = makeEnv()
    const plain = quizWith(env, [choice('First?'), choice('Second?')])
    expect((await open(plain, 'student')).xml).not.toMatch(/pts?\)/)

    const mixed = quizWith(env, [choice('First?', 1, { points: 2 }), choice('Second?')])
    const text = (await open(mixed, 'student')).paragraphs.map((p) => p.text)
    expect(text).toContain('First? (2 pts)')
    expect(text).toContain('Second? (1 pt)')

    // A per-quiz override counts, not just the question's own value.
    const overridden = quizWith(env, [choice('Only?')])
    const bumped = env.repos.quizzes.setPoints(overridden.id, overridden.entries[0].questionId, 5)
    expect((await open(bumped, 'student')).paragraphs.map((p) => p.text)).toContain('Only? (5 pts)')
  })

  it('adds a Part heading for each run of one kind when a quiz mixes kinds, but not otherwise', async () => {
    const env = makeEnv()
    const mixed = quizWith(env, [
      choice('MC one?'),
      choice('MC two?'),
      { kind: 'true-false', prompt: 'TF?', correctChoice: 0 },
      { kind: 'essay', prompt: 'Essay?' }
    ])
    const { paragraphs } = await open(mixed, 'student')
    const headings = paragraphs.filter((p) => /^Part /.test(p.text))
    expect(headings.map((p) => p.text)).toEqual([
      'Part I: Multiple Choice',
      'Part II: True / False',
      'Part III: Essay'
    ])
    for (const h of headings) {
      expect(h.xml).toMatch(/<w:keepNext\/>/)
      expect(h.xml).toMatch(/<w:b\/>/)
      expect(numIdOf(h)).toBeNull() // headings are never numbered
    }
    // The question numbering carries on across the parts: still one list.
    const asked = paragraphs.filter((p) => /\?$/.test(p.text) && numIdOf(p) !== null)
    const listIds = new Set(
      asked.filter((p) => ['MC one?', 'MC two?', 'TF?', 'Essay?'].includes(p.text)).map(numIdOf)
    )
    expect(listIds.size).toBe(1)

    const single = quizWith(env, [choice('Only?')])
    expect((await open(single, 'student')).paragraphs.some((p) => /^Part /.test(p.text))).toBe(
      false
    )
  })

  it('follows the quiz order, not the order questions were written', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [choice('A?'), choice('B?'), choice('C?')])
    const [a, b, c] = quiz.entries.map((e) => e.questionId)
    const reordered = env.repos.quizzes.reorder(quiz.id, [c, a, b])
    const text = (await open(reordered, 'student')).paragraphs.map((p) => p.text)
    expect(text.filter((t) => /^[ABC]\?$/.test(t))).toEqual(['C?', 'A?', 'B?'])
  })

  it('keeps typed line breaks and special characters in a question', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [choice('Read this:\n  "To be & not to be" <quoted>\nThen answer.')])
    const raw = await mammoth.extractRawText({ buffer: await quizDocx(quiz, 'student') })
    expect(raw.value).toContain('Read this:')
    expect(raw.value).toContain('"To be & not to be" <quoted>')
    expect(raw.value).toContain('Then answer.')
  })
})

describe('quiz Word document: answer key', () => {
  it('bolds the correct choice and marks it, once per choice question', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [
      choice('First?', 1),
      { kind: 'true-false', prompt: 'Second?', correctChoice: 1 }
    ])
    const { paragraphs } = await open(quiz, 'key')
    const beta = paragraphs.find((p) => p.text.startsWith('beta'))!
    expect(beta.text).toBe('beta (correct)')
    expect(beta.xml).toMatch(/<w:b\/>/)
    const alpha = paragraphs.find((p) => p.text === 'alpha')!
    expect(alpha.xml).not.toMatch(/<w:b\/>/)
    expect(paragraphs.find((p) => p.text.startsWith('False'))!.text).toBe('False (correct)')
    expect(paragraphs.find((p) => p.text === 'True')).toBeDefined()
    expect(paragraphs.filter((p) => p.text.includes('(correct)'))).toHaveLength(2)
  })

  it('shows the model answer for written questions instead of ruled lines', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [
      { kind: 'short-answer', prompt: 'Short?', answer: 'Because.' },
      { kind: 'essay', prompt: 'Long?' } // no model answer written: nothing is shown for it
    ])
    const { paragraphs, xml } = await open(quiz, 'key')
    expect(paragraphs.filter((p) => p.text.startsWith('Answer: ')).map((p) => p.text)).toEqual([
      'Answer: Because.'
    ])
    expect(xml).not.toMatch(/w:leader="underscore"/)
  })

  it('has the same questions in the same order as the student copy', async () => {
    const env = makeEnv()
    const quiz = quizWith(env, [choice('A?'), { kind: 'essay', prompt: 'B?' }, choice('C?')])
    const asked = async (v: 'student' | 'key') =>
      (await open(quiz, v)).paragraphs.map((p) => p.text).filter((t) => /^[ABC]\?$/.test(t))
    expect(await asked('key')).toEqual(await asked('student'))
  })
})

describe('quiz export service', () => {
  function service(pick: (name: string) => Promise<string | null>) {
    const env = makeEnv()
    const quiz = quizWith(env, [choice('First?')])
    const svc = createQuizService(env.repos, { pickSaveFile: pick, today: () => '2026-10-01' })
    return { env, quiz, svc }
  }
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'tos-quiz-'))
    dirs.push(d)
    return d
  }

  it('suggests a dated name, asks where to save, and writes a real Word file', async () => {
    const dir = tmp()
    let suggested = ''
    const { quiz, svc } = service(async (name) => {
      suggested = name
      return join(dir, name)
    })
    const res = await svc.exportWord(quiz.id, 'student')
    expect(suggested).toBe('2026-10-01 PHIL 101 Quiz 3.docx')
    expect(res).toEqual({ path: join(dir, suggested) })
    const raw = await mammoth.extractRawText({ path: res!.path })
    expect(raw.value).toContain('PHIL 101 • Quiz 3 • October 2, 2026')
    expect(raw.value).toContain('First?')
  })

  it('names the answer key, and adds .docx when the chosen name has none', async () => {
    const dir = tmp()
    let suggested = ''
    const { quiz, svc } = service(async (name) => {
      suggested = name
      return join(dir, 'my key')
    })
    const res = await svc.exportWord(quiz.id, 'key')
    expect(suggested).toBe('2026-10-01 PHIL 101 Quiz 3 Answer Key.docx')
    expect(res!.path).toBe(join(dir, 'my key.docx'))
    expect(readdirSync(dir)).toEqual(['my key.docx'])
  })

  it('keeps characters a file name cannot hold out of the suggestion', async () => {
    let suggested = ''
    const env = makeEnv()
    const quiz = quizWith(env, [choice('First?')], { course: 'A/B', title: 'Quiz: 1?' })
    const svc = createQuizService(env.repos, {
      pickSaveFile: async (name) => {
        suggested = name
        return null
      },
      today: () => '2026-10-01'
    })
    await svc.exportWord(quiz.id, 'student')
    expect(suggested).toBe('2026-10-01 A B Quiz 1.docx')
  })

  it('writes nothing when the save is cancelled', async () => {
    const { quiz, svc } = service(async () => null)
    expect(await svc.exportWord(quiz.id, 'student')).toBeNull()
  })

  it('refuses an empty quiz, a missing quiz and an unknown version before asking where to save', async () => {
    let asked = 0
    const env = makeEnv()
    const empty = env.repos.quizzes.create({ title: 'Empty' })
    const svc = createQuizService(env.repos, {
      pickSaveFile: async () => {
        asked++
        return null
      }
    })
    await expect(svc.exportWord(empty.id, 'student')).rejects.toThrow(/Add some questions/)
    await expect(svc.exportWord(9999, 'student')).rejects.toThrow(/no longer exists/)
    await expect(svc.exportWord(empty.id, 'both' as never)).rejects.toThrow(/one of/)
    expect(asked).toBe(0)
  })

  it('produces a file that Word-compatible readers can open twice with the same content', async () => {
    const dir = tmp()
    const { quiz, svc } = service(async (name) => join(dir, name))
    const first = await svc.exportWord(quiz.id, 'student')
    const a = readFileSync(first!.path)
    const zip = await JSZip.loadAsync(a)
    expect(Object.keys(zip.files)).toContain('word/document.xml')
    expect(Object.keys(zip.files)).toContain('word/numbering.xml')
  })
})
