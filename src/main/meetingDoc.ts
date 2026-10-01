import { AlignmentType, Document, LevelFormat, Packer, Paragraph, TextRun } from 'docx'
import { formatDate, meetingBody } from '@shared/advising'
import type { ActionItem, AdvisingMeeting } from '@shared/models'
import { longDate } from '@shared/quiz'

/**
 * The house style for a written-up advising meeting: Palatino Linotype 12pt on every run, one
 * centered bold "Advising Meeting • Name • Date" line, the topic, the summary (or the working notes
 * until there is a summary), then a real Word bullet list of next steps for the student and for the
 * teacher. US Letter with 1 inch margins: this is a letter-like record, not an exam.
 */
const FONT = 'Palatino Linotype'
const SIZE = 24 // half-points: 12pt
const INCH = 1440 // twips
const HANG = 360

const run = (text: string, opts: { bold?: boolean } = {}): TextRun =>
  new TextRun({ text, font: FONT, size: SIZE, ...opts })

/** Runs for text that may hold line breaks, so a typed paragraph break survives in the document. */
const textRuns = (text: string): TextRun[] =>
  text
    .split(/\r?\n/)
    .map(
      (line, i) =>
        new TextRun({ text: line, font: FONT, size: SIZE, ...(i > 0 ? { break: 1 } : {}) })
    )

export interface MeetingDocInput {
  studentName: string
  meeting: Pick<AdvisingMeeting, 'metOn' | 'topic' | 'notes' | 'summary'>
  followUps: readonly Pick<ActionItem, 'title' | 'dueDate' | 'owner'>[]
}

export function meetingDocument({ studentName, meeting, followUps }: MeetingDocInput): Document {
  const children: Paragraph[] = []
  const header = ['Advising Meeting', studentName, longDate(meeting.metOn)]
    .filter((p) => p !== '')
    .join(' • ')
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [run(header, { bold: true })]
    })
  )

  if (meeting.topic) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [run('Topic: ', { bold: true }), ...textRuns(meeting.topic)]
      })
    )
  }

  const body = meetingBody(meeting)
  if (body.text) {
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { after: 80 },
        children: [run(body.label, { bold: true })]
      })
    )
    // One paragraph per line, so a blank line in the notes is a gap in the document.
    for (const line of body.text.split(/\r?\n/)) {
      children.push(
        new Paragraph({
          spacing: { after: line.trim() === '' ? 0 : 120 },
          children: line.trim() === '' ? [] : [run(line)]
        })
      )
    }
  }

  const steps = (title: string, items: typeof followUps): void => {
    if (items.length === 0) return
    children.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 240, after: 80 },
        children: [run(title, { bold: true })]
      })
    )
    items.forEach((a, i) => {
      children.push(
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          keepLines: true,
          keepNext: i < items.length - 1,
          spacing: { after: 60 },
          children: [run(a.title), ...(a.dueDate ? [run(` (by ${formatDate(a.dueDate)})`)] : [])]
        })
      )
    })
  }
  steps(
    `Next steps for ${studentName || 'the student'}`,
    followUps.filter((a) => a.owner === 'student')
  )
  steps(
    'Next steps for me',
    followUps.filter((a) => a.owner === 'me')
  )

  return new Document({
    title: `Advising meeting ${meeting.metOn}`,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    numbering: {
      config: [
        {
          reference: 'steps',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: HANG * 2, hanging: HANG } },
                run: { font: FONT, size: SIZE }
              }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 8.5 * INCH, height: 11 * INCH },
            margin: { top: INCH, bottom: INCH, left: INCH, right: INCH }
          }
        },
        children
      }
    ]
  })
}

export const meetingDocx = (input: MeetingDocInput): Promise<Buffer> =>
  Packer.toBuffer(meetingDocument(input))
