import type { QuestionKind, QuizKind } from './models'

/** `Assignment.sourceApp` for assignments the Quiz Builder created in the Gradebook. */
export const QUIZ_SOURCE_APP = 'quiz-builder'

export const QUESTION_KINDS: readonly QuestionKind[] = [
  'multiple-choice',
  'true-false',
  'short-answer',
  'essay'
]
export const QUIZ_KINDS: readonly QuizKind[] = ['quiz', 'exam']

export const MIN_CHOICES = 2
export const MAX_CHOICES = 6
export const TRUE_FALSE_CHOICES: readonly string[] = ['True', 'False']

const KIND_LABELS: Record<QuestionKind, string> = {
  'multiple-choice': 'Multiple choice',
  'true-false': 'True / false',
  'short-answer': 'Short answer',
  essay: 'Essay'
}
export const kindLabel = (kind: QuestionKind): string => KIND_LABELS[kind]

export const hasChoices = (kind: QuestionKind): boolean =>
  kind === 'multiple-choice' || kind === 'true-false'

/** 0 -> "a", 1 -> "b". */
export const choiceLetter = (index: number): string => String.fromCharCode(97 + index)

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** "2026-10-02" -> "October 2, 2026". Read by hand so the time zone can never move the day. */
export function longDate(date: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : ''
}

/** The single centered line at the top of an exam: Course • Title • Date, leaving out what is blank. */
export function examHeader(parts: { course: string; title: string; date: string | null }): string {
  return [parts.course.trim(), parts.title.trim(), longDate(parts.date)]
    .filter((p) => p !== '')
    .join(' • ')
}

/** 1 -> "I", 4 -> "IV". Enough for the handful of parts an exam has. */
export function roman(n: number): string {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ]
  let left = n
  let out = ''
  for (const [value, symbol] of table) {
    while (left >= value) {
      out += symbol
      left -= value
    }
  }
  return out
}

export const pointsLabel = (points: number): string =>
  `${Number.isInteger(points) ? points : Number(points.toFixed(2))} ${points === 1 ? 'pt' : 'pts'}`

/** Adds points the way the gradebook would show them, free of floating point dust (0.1 + 0.2). */
export const sumPoints = (values: number[]): number =>
  Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000

/** Runs of questions of the same kind, in quiz order: what an exam's "Part I, Part II" are. */
export function partsOf<T extends { kind: QuestionKind }>(
  items: T[]
): { kind: QuestionKind; items: T[] }[] {
  const parts: { kind: QuestionKind; items: T[] }[] = []
  for (const item of items) {
    const last = parts[parts.length - 1]
    if (last && last.kind === item.kind) last.items.push(item)
    else parts.push({ kind: item.kind, items: [item] })
  }
  return parts
}
