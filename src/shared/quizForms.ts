import type { QuizDetail, QuizEntry } from './models'
import { hasChoices, partsOf, type QuizVersion } from './quiz'

/**
 * A/B versions of one quiz, so neighbours do not share an order. Form A is the quiz as built. Form B
 * has the questions shuffled within each part (so the Part headings stay where they are) and the
 * choices of each multiple-choice question shuffled.
 *
 * The shuffle is seeded from the quiz and its questions, so the student copy and the answer key of
 * Form B always agree, and exporting again gives the same Form B until the quiz changes.
 */
export const QUIZ_FORMS = ['A', 'B'] as const
export type QuizForm = (typeof QUIZ_FORMS)[number]

/** "All of the above", "None of these", "Both of the above": a choice that only makes sense last. */
const ALWAYS_LAST = /^(all|none|both|neither)\b.*\b(above|these|them)\b/i
/** "A and C", "b, c": a choice that points at other choices by letter, so nothing can move. */
const POINTS_BY_LETTER = /\b[a-f]\b\s*(?:,|and|&|or)\s*\b[a-f]\b/i

/** A small seeded generator (FNV-1a into mulberry32): the same text always gives the same numbers. */
function seeded(text: string): () => number {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0
  let a = h
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Indexes 0..n-1 in a shuffled order that is never the original one (for n of 2 or more). */
function permutation(n: number, random: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const same = order.every((v, i) => v === i)
  // Rotating by one moves every item, so Form B is never a copy of Form A by chance.
  return same && n > 1 ? order.map((_, i) => (i + 1) % n) : order
}

/** The question's choices in a new order, with the right answer's index following its text. */
function shuffleChoices(
  entry: QuizEntry,
  random: () => number
): Pick<QuizEntry['question'], 'choices' | 'correctChoice'> {
  const { choices, correctChoice } = entry.question
  if (!hasChoices(entry.question.kind) || entry.question.kind === 'true-false') {
    return { choices, correctChoice }
  }
  if (choices.some((c) => POINTS_BY_LETTER.test(c))) return { choices, correctChoice }
  const last = choices.map((c, i) => (ALWAYS_LAST.test(c.trim()) ? i : -1)).filter((i) => i >= 0)
  const movable = choices.map((_, i) => i).filter((i) => !last.includes(i))
  if (movable.length < 2) return { choices, correctChoice }
  const order = [...permutation(movable.length, random).map((p) => movable[p]), ...last]
  return {
    choices: order.map((i) => choices[i]),
    correctChoice: correctChoice === null ? null : order.indexOf(correctChoice)
  }
}

/** The quiz as it is printed for a form. Form A, or no form, is the quiz unchanged. */
export function quizForForm(quiz: QuizDetail, form: QuizForm | null | undefined): QuizDetail {
  if (form !== 'B') return quiz
  const random = seeded(`${quiz.id}|B|${quiz.entries.map((e) => e.questionId).join(',')}`)
  const slots = quiz.entries.map((e) => e.position)
  const shuffled: QuizEntry[] = []
  for (const part of partsOf(quiz.entries.map((entry) => ({ kind: entry.question.kind, entry })))) {
    const order = part.items.length > 1 ? permutation(part.items.length, random) : [0]
    for (const i of order) shuffled.push(part.items[i].entry)
  }
  const entries = shuffled.map((entry, i) => ({
    ...entry,
    position: slots[i],
    question: { ...entry.question, ...shuffleChoices(entry, random) }
  }))
  return { ...quiz, entries }
}

/** What goes after the title: "(Form B)", "(Answer Key)", "(Form B Answer Key)", or nothing. */
export function versionSuffix(version: QuizVersion, form: QuizForm | null | undefined): string {
  const bits = [form ? `Form ${form}` : '', version === 'key' ? 'Answer Key' : ''].filter(Boolean)
  return bits.join(' ')
}
