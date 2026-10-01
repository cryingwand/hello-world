import type { ActionItem, AdvisingMeeting } from './models'

/** Today as YYYY-MM-DD in the machine's own time zone (what the teacher means by "today"). */
export function localToday(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** A follow-up is overdue the day after its due date. Dates are YYYY-MM-DD, so they compare as text. */
export function isOverdue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && dueDate < today
}

/** "Oct 1, 2026". Falls back to the raw text for anything that is not a plain date. */
export function formatDate(date: string | null): string {
  if (!date) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ]
  const month = months[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : date
}

/**
 * Plain text for pasting into an email or a record: who, when, what was said, and who does what
 * next. Uses the written summary, and falls back to the working notes when there is no summary yet.
 */
export function meetingSummaryText(
  studentName: string,
  meeting: Pick<AdvisingMeeting, 'metOn' | 'topic' | 'notes' | 'summary'>,
  followUps: readonly Pick<ActionItem, 'title' | 'dueDate' | 'owner'>[]
): string {
  const lines = [`Advising meeting with ${studentName}`, formatDate(meeting.metOn)]
  if (meeting.topic) lines.push(`Topic: ${meeting.topic}`)
  const body = meeting.summary.trim() || meeting.notes.trim()
  if (body) lines.push('', body)
  const line = (a: Pick<ActionItem, 'title' | 'dueDate'>): string =>
    `- ${a.title}${a.dueDate ? ` (by ${formatDate(a.dueDate)})` : ''}`
  const mine = followUps.filter((a) => a.owner === 'me')
  const theirs = followUps.filter((a) => a.owner === 'student')
  if (theirs.length > 0) lines.push('', 'Next steps for the student:', ...theirs.map(line))
  if (mine.length > 0) lines.push('', 'Next steps for me:', ...mine.map(line))
  return lines.join('\n')
}
