import {
  BLOCK_INFO,
  agendaLine,
  blockKind,
  formatMinutes,
  minutesByKind,
  plannedMinutes
} from '@shared/lessonBlocks'
import type { LessonBlock } from '@shared/models'

/** The class name that colours a block of this kind (see `.kind-*` in styles.css). */
export const kindClass = (kind: string): string => `kind-${blockKind(kind)}`

/**
 * A lesson at a glance: one coloured segment per block, as wide as it is long. When the class length
 * is known, the time left over shows as an empty stretch, and a plan that runs over is marked.
 */
export function RoadmapBar({
  blocks,
  classMinutes = null,
  size = 'small'
}: {
  blocks: LessonBlock[]
  classMinutes?: number | null
  size?: 'small' | 'large'
}): React.JSX.Element {
  const planned = plannedMinutes(blocks)
  const spare = classMinutes ? Math.max(classMinutes - planned, 0) : 0
  const over = classMinutes !== null && planned > classMinutes
  if (blocks.length === 0) {
    return <span className={`roadmap roadmap-${size} roadmap-empty`} aria-hidden="true" />
  }
  return (
    <span
      className={`roadmap roadmap-${size}${over ? ' roadmap-over' : ''}`}
      role="img"
      aria-label={blocks.map(agendaLine).join(', ')}
    >
      {blocks.map((b) => (
        <span
          key={b.id}
          className={`roadmap-seg ${kindClass(b.kind)}`}
          // A block with no length still gets a sliver, so it is never invisible.
          style={{ flexGrow: Math.max(b.minutes ?? 0, 2) }}
          title={agendaLine(b)}
        />
      ))}
      {spare > 0 && (
        <span
          className="roadmap-seg roadmap-spare"
          style={{ flexGrow: spare }}
          title={`${formatMinutes(spare)} not planned yet`}
        />
      )}
    </span>
  )
}

/** Where the time goes across many lessons: "Lecture 2 h · Discussion 45 min". */
export function KindMix({ blocks }: { blocks: LessonBlock[] }): React.JSX.Element | null {
  const mix = minutesByKind(blocks)
  if (mix.length === 0) return null
  const total = mix.reduce((s, m) => s + m.minutes, 0)
  return (
    <ul className="kind-mix" aria-label="Time by kind">
      {mix.map((m) => (
        <li key={m.kind} className={kindClass(m.kind)}>
          <span className="kind-dot" />
          {BLOCK_INFO[m.kind].label}{' '}
          <span className="hint">
            {formatMinutes(m.minutes)} · {Math.round((m.minutes / total) * 100)}%
          </span>
        </li>
      ))}
    </ul>
  )
}
