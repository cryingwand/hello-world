import PptxGenJS from 'pptxgenjs'
import type { Lesson, UnitDetail } from '@shared/models'
import { chunkBullets, dateSpan, linesOf } from '@shared/lesson'
import { agendaLine } from '@shared/lessonBlocks'
import { longDate } from '@shared/quiz'

/**
 * The deck a unit (or one lesson) is exported as: 16:9, white, Palatino Linotype throughout to match
 * the Word house style. A unit deck opens with a title slide, then an overview and a list of lessons.
 * Each lesson gets a slide with its title, date and objectives, then its agenda (the blocks it is
 * built from, by name and length; a block's own notes stay off the slides), its plan, its homework
 * and the quizzes it uses. Bullets that would not fit are continued on another slide instead of running off
 * the bottom. A lesson's private notes become speaker notes on each of its slides, so they never show
 * on the projector.
 *
 * Only quiz and exam titles are written, never their questions or answers: the file is an ordinary
 * file, and the Vault cannot protect it once it is saved.
 */
const FONT = 'Palatino Linotype'
const INK = '1F2933'
const MUTED = '616E7C'

/** Lines that fit under a heading at the body size, and characters before a bullet wraps. */
const BUDGET = 7
const PER_LINE = 60

const PAGE_W = 10
const MARGIN = 0.5
const TEXT_W = PAGE_W - 2 * MARGIN

type Slide = ReturnType<PptxGenJS['addSlide']>

interface Frame {
  pres: PptxGenJS
  /** Shown small at the bottom of every lesson slide, so a lone lesson still says where it belongs. */
  footer: string
}

function slide(frame: Frame, notes: string, footer = true): Slide {
  const s = frame.pres.addSlide()
  s.background = { color: 'FFFFFF' }
  if (footer && frame.footer !== '') {
    s.addText(frame.footer, {
      x: MARGIN,
      y: 5.15,
      w: 7.5,
      h: 0.3,
      fontFace: FONT,
      fontSize: 11,
      color: MUTED
    })
  }
  s.slideNumber = { x: 9.0, y: 5.15, w: 0.5, h: 0.3, fontFace: FONT, fontSize: 11, color: MUTED }
  if (notes !== '') s.addNotes(notes)
  return s
}

function heading(s: Slide, title: string, sub = ''): void {
  s.addText(title, {
    x: MARGIN,
    y: 0.3,
    w: TEXT_W,
    h: 0.85,
    fontFace: FONT,
    fontSize: 26,
    bold: true,
    color: INK,
    valign: 'middle',
    fit: 'shrink'
  })
  if (sub !== '') {
    s.addText(sub, {
      x: MARGIN,
      y: 1.15,
      w: TEXT_W,
      h: 0.4,
      fontFace: FONT,
      fontSize: 16,
      italic: true,
      color: MUTED,
      valign: 'middle'
    })
  }
}

function bullets(s: Slide, lines: string[]): void {
  s.addText(
    lines.map((text, i) => ({
      text,
      options: { bullet: true, breakLine: i < lines.length - 1 }
    })),
    {
      x: MARGIN,
      y: 1.7,
      w: TEXT_W,
      h: 3.3,
      fontFace: FONT,
      fontSize: 20,
      color: INK,
      valign: 'top',
      paraSpaceAfter: 6
    }
  )
}

/** One or more slides for a list: "Plan", then "Plan (2 of 3)" if it needs a second slide. */
function listSlides(
  frame: Frame,
  title: string,
  label: string,
  lines: string[],
  notes: string,
  footer = true
): void {
  const parts = chunkBullets(lines, BUDGET, PER_LINE)
  parts.forEach((part, i) => {
    const s = slide(frame, notes, footer)
    heading(s, title, parts.length > 1 ? `${label} (${i + 1} of ${parts.length})` : label)
    bullets(s, part)
  })
}

const lessonLine = (l: Lesson): string => (l.date ? `${l.title} — ${longDate(l.date)}` : l.title)

function lessonSlides(frame: Frame, lesson: Lesson): void {
  const notes = lesson.notes

  // The lesson's first slide always exists, so a lesson with nothing written still has a marker.
  const objectives = chunkBullets(linesOf(lesson.objectives), BUDGET - 1, PER_LINE)
  const sub = lesson.date ? longDate(lesson.date) : ''
  if (objectives.length === 0) {
    const s = slide(frame, notes)
    heading(s, lesson.title, sub)
  } else {
    objectives.forEach((part, i) => {
      const s = slide(frame, notes)
      const more = objectives.length > 1 ? ` (${i + 1} of ${objectives.length})` : ''
      heading(s, lesson.title, `${[sub, 'Objectives'].filter((p) => p !== '').join(' • ')}${more}`)
      bullets(s, part)
    })
  }

  const agenda = lesson.blocks.map(agendaLine)
  if (agenda.length > 0) listSlides(frame, lesson.title, 'Agenda', agenda, notes)
  const plan = linesOf(lesson.plan)
  if (plan.length > 0) listSlides(frame, lesson.title, 'Plan', plan, notes)
  const homework = linesOf(lesson.homework)
  if (homework.length > 0) listSlides(frame, lesson.title, 'Homework', homework, notes)
  if (lesson.quizzes.length > 0) {
    const names = lesson.quizzes.map(
      (q) =>
        `${q.kind === 'exam' ? 'Exam' : 'Quiz'}: ${q.title}${q.date ? ` (${longDate(q.date)})` : ''}`
    )
    listSlides(frame, lesson.title, 'Quizzes and exams', names, notes)
  }
}

/** A .pptx for the whole unit, or for one lesson in it when `lessonId` is given. */
export async function lessonDeck(
  unit: UnitDetail,
  lessonId: number | null = null
): Promise<Buffer> {
  const only = lessonId === null ? null : unit.lessons.find((l) => l.id === lessonId)
  if (lessonId !== null && !only) throw new Error('That lesson is not in this unit')

  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_16x9'
  pres.title = only ? only.title : unit.title
  pres.subject = unit.course
  pres.author = ''
  pres.company = ''
  const frame: Frame = {
    pres,
    footer: [unit.course, unit.title].filter((p) => p.trim() !== '').join(' • ')
  }

  if (only) {
    lessonSlides(frame, only)
  } else {
    const dates = unit.lessons
      .map((l) => l.date)
      .filter((d): d is string => d !== null)
      .sort()
    const title = slide(frame, '', false)
    title.addText(unit.title, {
      x: MARGIN,
      y: 1.6,
      w: TEXT_W,
      h: 1.3,
      fontFace: FONT,
      fontSize: 40,
      bold: true,
      color: INK,
      align: 'center',
      valign: 'middle',
      fit: 'shrink'
    })
    const subtitle = [unit.course, dateSpan(dates[0] ?? null, dates[dates.length - 1] ?? null)]
      .filter((p) => p !== '')
      .join(' • ')
    if (subtitle !== '') {
      title.addText(subtitle, {
        x: MARGIN,
        y: 3.0,
        w: TEXT_W,
        h: 0.6,
        fontFace: FONT,
        fontSize: 20,
        color: MUTED,
        align: 'center',
        valign: 'middle'
      })
    }

    const overview = linesOf(unit.summary)
    if (overview.length > 0) listSlides(frame, unit.title, 'Overview', overview, '')
    if (unit.lessons.length > 1) {
      listSlides(frame, unit.title, 'Lessons', unit.lessons.map(lessonLine), '')
    }
    for (const lesson of unit.lessons) lessonSlides(frame, lesson)
  }

  const out = await pres.write({ outputType: 'nodebuffer' })
  return Buffer.from(out as Uint8Array)
}
