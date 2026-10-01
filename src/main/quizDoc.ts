import {
  AlignmentType,
  Document,
  LeaderType,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun
} from 'docx'
import type { QuizDetail, QuizEntry } from '@shared/models'
import {
  examHeader,
  hasChoices,
  kindLabel,
  partsOf,
  pointsLabel,
  roman,
  type QuizVersion
} from '@shared/quiz'
import { quizForForm, versionSuffix, type QuizForm } from '@shared/quizForms'

/**
 * The house style for printed quizzes and exams: Palatino Linotype 12pt on every run, one centered
 * bold "Course • Title • Date" line, one real Word numbered list for the questions (continuing across
 * parts), a lettered list for each question's choices that restarts at "a." every time, and a question
 * kept whole on one page. A form letter, when there is one, goes in the title: "Quiz 3 (Form B)". US Letter with 0.75 inch top and bottom and 0.5 inch side margins.
 */
const FONT = 'Palatino Linotype'
const SIZE = 24 // half-points: 12pt
const INCH = 1440 // twips
const HANG = 432
const GAP_AFTER = 200
/** Page width less the side margins: where a ruled line ends. */
const TEXT_WIDTH = 7.5 * INCH

/** Lines to write on, for the student copy. */
const ANSWER_LINES = { 'short-answer': 3, essay: 8 } as const

const run = (text: string, opts: { bold?: boolean; italics?: boolean } = {}): TextRun =>
  new TextRun({ text, font: FONT, size: SIZE, ...opts })

/** Runs for text that may hold line breaks, so a typed paragraph break survives in the document. */
function textRuns(text: string, opts: { bold?: boolean; italics?: boolean } = {}): TextRun[] {
  return text.split(/\r?\n/).map(
    (line, i) =>
      new TextRun({
        text: line,
        font: FONT,
        size: SIZE,
        ...opts,
        ...(i > 0 ? { break: 1 } : {})
      })
  )
}

const partTitle = (kind: Parameters<typeof kindLabel>[0]): string =>
  kindLabel(kind).replace(/\b[a-z]/g, (c) => c.toUpperCase())

/** Points are printed unless every question is worth exactly one point. */
const showPoints = (entries: QuizEntry[]): boolean => entries.some((e) => e.points !== 1)

export function quizDocument(
  printed: QuizDetail,
  version: QuizVersion,
  form?: QuizForm | null
): Document {
  const key = version === 'key'
  const quiz = quizForForm(printed, form)
  const suffix = versionSuffix(version, form)
  const children: Paragraph[] = []

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        run(
          examHeader({
            course: quiz.course,
            title: suffix ? `${quiz.title} (${suffix})` : quiz.title,
            date: quiz.date
          }),
          { bold: true }
        )
      ]
    })
  )

  for (const line of quiz.instructions.split(/\r?\n/)) {
    if (line.trim() === '') continue
    children.push(new Paragraph({ spacing: { after: 120 }, children: textRuns(line) }))
  }

  const parts = partsOf(quiz.entries.map((entry) => ({ kind: entry.question.kind, entry })))
  const points = showPoints(quiz.entries)
  let optionLists = 0 // each question's choices are their own list, so lettering restarts

  parts.forEach((part, partIndex) => {
    if (parts.length > 1) {
      children.push(
        new Paragraph({
          keepNext: true,
          spacing: { before: 240, after: 120 },
          children: [run(`Part ${roman(partIndex + 1)}: ${partTitle(part.kind)}`, { bold: true })]
        })
      )
    }

    for (const { entry } of part.items) {
      const q = entry.question
      // What follows the prompt, so the prompt keeps with it and the last piece carries the gap.
      const follow: Paragraph[] = []
      const gap = (more: boolean): { after: number } => ({ after: more ? 0 : GAP_AFTER })

      if (hasChoices(q.kind)) {
        const instance = optionLists++
        q.choices.forEach((choice, i) => {
          const correct = key && q.correctChoice === i
          follow.push(
            new Paragraph({
              numbering: { reference: 'options', level: 0, instance },
              keepLines: true,
              keepNext: i < q.choices.length - 1,
              spacing: gap(i < q.choices.length - 1),
              children: [
                ...textRuns(choice, { bold: correct }),
                ...(correct ? [run(' (correct)')] : [])
              ]
            })
          )
        })
      } else if (key) {
        if (q.answer !== '') {
          follow.push(
            new Paragraph({
              indent: { left: HANG },
              keepLines: true,
              spacing: gap(false),
              children: [run('Answer: ', { bold: true }), ...textRuns(q.answer, { italics: true })]
            })
          )
        }
      } else {
        const lines = ANSWER_LINES[q.kind as keyof typeof ANSWER_LINES]
        for (let i = 0; i < lines; i++) {
          const last = i === lines - 1
          follow.push(
            new Paragraph({
              indent: { left: HANG },
              keepLines: true,
              keepNext: !last,
              spacing: { before: 360, ...gap(false) },
              // A tab with an underscore leader, because adjacent paragraphs with identical bottom
              // borders are drawn as one box and only the last line would show.
              tabStops: [
                { type: TabStopType.RIGHT, position: TEXT_WIDTH, leader: LeaderType.UNDERSCORE }
              ],
              children: [new TextRun({ children: [new Tab()], font: FONT, size: SIZE })]
            })
          )
        }
      }

      children.push(
        new Paragraph({
          numbering: { reference: 'questions', level: 0 },
          keepLines: true,
          keepNext: follow.length > 0,
          spacing: gap(follow.length > 0),
          children: [
            ...textRuns(q.prompt),
            ...(points ? [run(` (${pointsLabel(entry.points)})`)] : [])
          ]
        }),
        ...follow
      )
    }
  })

  const level = (format: (typeof LevelFormat)[keyof typeof LevelFormat], left: number) => ({
    level: 0,
    format,
    text: '%1.',
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: { indent: { left, hanging: HANG } },
      run: { font: FONT, size: SIZE }
    }
  })

  return new Document({
    title: quiz.title,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    numbering: {
      config: [
        { reference: 'questions', levels: [level(LevelFormat.DECIMAL, HANG)] },
        { reference: 'options', levels: [level(LevelFormat.LOWER_LETTER, HANG * 2)] }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 8.5 * INCH, height: 11 * INCH },
            margin: { top: 0.75 * INCH, bottom: 0.75 * INCH, left: 0.5 * INCH, right: 0.5 * INCH }
          }
        },
        children
      }
    ]
  })
}

export const quizDocx = (
  quiz: QuizDetail,
  version: QuizVersion,
  form?: QuizForm | null
): Promise<Buffer> => Packer.toBuffer(quizDocument(quiz, version, form))
