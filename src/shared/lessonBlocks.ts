/**
 * The building blocks of a lesson, picked from a panel in the Lesson Planner: a lecture, a discussion,
 * a reading and so on, in the order they happen, each with a rough length. Adding a block also adds
 * the prep it needs to the lesson's to-do list (`BLOCK_INFO[kind].tasks`); the teacher can change or
 * remove those tasks like any other.
 *
 * A kind is stored as its id, so an id must never be renamed. A kind this list does not know (from a
 * newer version of the app) is shown as "Other".
 */
export const BLOCK_KINDS = [
  'lecture',
  'discussion',
  'writing',
  'reading',
  'group',
  'activity',
  'video',
  'assessment',
  'presentation',
  'review',
  'break',
  'other'
] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]

export interface BlockKindInfo {
  label: string
  /** One line in the panel saying what the block is for. */
  hint: string
  /** Minutes a new block of this kind starts with. */
  minutes: number
  /** Prep added to the to-do list with a new block. */
  tasks: readonly string[]
}

export const BLOCK_INFO: Record<BlockKind, BlockKindInfo> = {
  lecture: {
    label: 'Lecture',
    hint: 'You explain; they take notes',
    minutes: 20,
    tasks: ['Prepare the slides or notes']
  },
  discussion: {
    label: 'Discussion',
    hint: 'Whole-class conversation',
    minutes: 15,
    tasks: ['Write the discussion questions']
  },
  writing: {
    label: 'Writing',
    hint: 'Free-write, response or draft',
    minutes: 10,
    tasks: ['Write the prompt']
  },
  reading: {
    label: 'Reading',
    hint: 'In class or before it',
    minutes: 15,
    tasks: ['Choose the reading', 'Share the reading with the class']
  },
  group: {
    label: 'Group work',
    hint: 'Pairs or small groups on a task',
    minutes: 15,
    tasks: ['Write the group task', 'Plan the groups']
  },
  activity: {
    label: 'Activity',
    hint: 'Hands-on, lab, game or simulation',
    minutes: 20,
    tasks: ['Write the instructions', 'Gather the materials']
  },
  video: {
    label: 'Video',
    hint: 'A clip to watch together',
    minutes: 10,
    tasks: ['Find the clip and check it plays']
  },
  assessment: {
    label: 'Quiz or check',
    hint: 'Quiz, exit ticket, poll',
    minutes: 10,
    tasks: ['Write the quiz or check']
  },
  presentation: {
    label: 'Presentations',
    hint: 'Students present their work',
    minutes: 20,
    tasks: ['Set the order of presenters']
  },
  review: {
    label: 'Review',
    hint: 'Recap or practice before a test',
    minutes: 10,
    tasks: ['Prepare the review questions']
  },
  break: {
    label: 'Break',
    hint: 'A pause in a long session',
    minutes: 5,
    tasks: []
  },
  other: {
    label: 'Other',
    hint: 'Anything else: announcements, admin',
    minutes: 5,
    tasks: []
  }
}

/** The kind as this version knows it: anything unknown is "other". */
export function blockKind(kind: string): BlockKind {
  return (BLOCK_KINDS as readonly string[]).includes(kind) ? (kind as BlockKind) : 'other'
}

/** Longest a single block may be, and a whole class: a long day of workshops. */
export const MAX_BLOCK_MINUTES = 600
/** Most blocks one lesson may hold, and most tasks. */
export const MAX_BLOCKS = 60
export const MAX_TASKS = 200

/** The minutes a lesson's blocks add up to. A block with no length counts as nothing. */
export function plannedMinutes(blocks: readonly { minutes: number | null }[]): number {
  return blocks.reduce((sum, b) => sum + (b.minutes ?? 0), 0)
}

/** Minutes per kind across many lessons, largest first, for the mix shown on a roadmap. */
export function minutesByKind(
  blocks: readonly { kind: string; minutes: number | null }[]
): { kind: BlockKind; minutes: number }[] {
  const by = new Map<BlockKind, number>()
  for (const b of blocks) {
    const k = blockKind(b.kind)
    by.set(k, (by.get(k) ?? 0) + (b.minutes ?? 0))
  }
  return [...by.entries()]
    .filter(([, m]) => m > 0)
    .map(([kind, minutes]) => ({ kind, minutes }))
    .sort(
      (a, b) => b.minutes - a.minutes || BLOCK_KINDS.indexOf(a.kind) - BLOCK_KINDS.indexOf(b.kind)
    )
}

/** "1 h 15 min", "45 min", "0 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** One line of a lesson's agenda: "Discussion: The trolley problem (15 min)". */
export function agendaLine(block: { kind: string; title: string; minutes: number | null }): string {
  const label = BLOCK_INFO[blockKind(block.kind)].label
  const title = block.title.trim()
  const name = title === '' || title === label ? label : `${label}: ${title}`
  return block.minutes ? `${name} (${block.minutes} min)` : name
}

export type TodoBucket = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'done'

export const TODO_BUCKETS: { id: TodoBucket; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'later', label: 'Later' },
  { id: 'undated', label: 'No date yet' },
  { id: 'done', label: 'Done' }
]

/** Days from `from` to `to`, both YYYY-MM-DD, counted in UTC so a daylight-saving change never shifts it. */
export function daysBetween(from: string, to: string): number {
  const t = (d: string): number => {
    const [y, m, day] = d.split('-').map(Number)
    return Date.UTC(y, m - 1, day)
  }
  return Math.round((t(to) - t(from)) / 86_400_000)
}

/**
 * Where a prep task sits in the to-do list. It is due on the day of its lesson: the slides are needed
 * by the time class starts.
 */
export function todoBucket(
  task: { done: boolean; lessonDate: string | null },
  today: string
): TodoBucket {
  if (task.done) return 'done'
  if (!task.lessonDate) return 'undated'
  const days = daysBetween(today, task.lessonDate)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  return days <= 7 ? 'week' : 'later'
}
