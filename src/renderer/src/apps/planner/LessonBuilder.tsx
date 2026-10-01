import { useRef, useState } from 'react'
import {
  BLOCK_INFO,
  BLOCK_KINDS,
  blockKind,
  formatMinutes,
  plannedMinutes,
  type BlockKind
} from '@shared/lessonBlocks'
import type { Lesson, LessonBlock } from '@shared/models'
import { RoadmapBar, kindClass } from './RoadmapBar'
import { useAutosave } from './useAutosave'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** What is being dragged: a new block from the panel, or a block already in the lesson. */
type Dragging = { kind: BlockKind } | { blockId: number }

/** "0:20" from the start of class. */
const clock = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

/**
 * Builds a lesson out of blocks. The panel on the left holds the kinds (lecture, discussion,
 * reading…): click one to add it at the end, or drag it to where it goes. Blocks can be dragged into
 * a new order. Each block brings its prep with it, which lands in the to-do list.
 */
export default function LessonBuilder({
  lesson,
  onError
}: {
  lesson: Lesson
  onError: (message: string) => void
}): React.JSX.Element {
  const dragging = useRef<Dragging | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const blocks = lesson.blocks
  const planned = plannedMinutes(blocks)
  const fail = (e: unknown): void => onError(msg(e))

  const add = (kind: BlockKind, position?: number): void => {
    window.api.lessons.addBlock(lesson.id, { kind, position }).catch(fail)
  }
  const moveTo = (blockId: number, index: number): void => {
    const ids = blocks.map((b) => b.id)
    const from = ids.indexOf(blockId)
    if (from === -1) return
    ids.splice(from, 1)
    // Dropping below its old place: everything after it moved up one.
    ids.splice(index > from ? index - 1 : index, 0, blockId)
    if (ids.every((id, i) => id === blocks[i].id)) return
    window.api.lessons.reorderBlocks(lesson.id, ids).catch(fail)
  }

  const endDrag = (): void => {
    dragging.current = null
    setDropAt(null)
  }
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const d = dragging.current
    const at = dropAt ?? blocks.length
    endDrag()
    if (!d) return
    if ('kind' in d) add(d.kind, at)
    else moveTo(d.blockId, at)
  }
  /** Over a block: drop before it in its top half, after it in its bottom half. */
  const overBlock = (index: number) => (e: React.DragEvent<HTMLElement>) => {
    if (!dragging.current) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1)
  }

  // When each block starts, in minutes from the start of class.
  const starts = blocks.map((_, i) => plannedMinutes(blocks.slice(0, i)))
  return (
    <section className="builder" aria-label="Lesson builder">
      <aside className="builder-panel" aria-label="Add to the lesson">
        <div className="builder-panel-head">Add to the lesson</div>
        {BLOCK_KINDS.map((kind) => {
          const info = BLOCK_INFO[kind]
          return (
            <button
              key={kind}
              className={`builder-kind ${kindClass(kind)}`}
              draggable
              onDragStart={(e) => {
                dragging.current = { kind }
                e.dataTransfer.effectAllowed = 'copy'
                e.dataTransfer.setData('text/plain', info.label)
              }}
              onDragEnd={endDrag}
              onClick={() => add(kind)}
              title={`${info.hint}. Click to add at the end, or drag into place.`}
            >
              <span className="kind-dot" />
              <span className="builder-kind-text">
                <span>{info.label}</span>
                <span className="hint">{info.hint}</span>
              </span>
            </button>
          )
        })}
      </aside>

      <div
        className="builder-lane"
        onDragOver={(e) => {
          if (!dragging.current) return
          e.preventDefault()
          // Below the last block: the end.
          if (e.target === e.currentTarget) setDropAt(blocks.length)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
        }}
        onDrop={onDrop}
      >
        <div className="builder-head">
          <strong>Session roadmap</strong>
          <span className="hint">
            {formatMinutes(planned)}
            {lesson.classMinutes
              ? ` of ${formatMinutes(lesson.classMinutes)}${planned > lesson.classMinutes ? ` · ${formatMinutes(planned - lesson.classMinutes)} over` : ''}`
              : ''}
          </span>
        </div>
        <RoadmapBar blocks={blocks} classMinutes={lesson.classMinutes} size="large" />

        {blocks.length === 0 ? (
          <div className={`builder-empty${dropAt !== null ? ' builder-drop-on' : ''}`}>
            Click a kind on the left, or drag it here, to start building this session.
          </div>
        ) : (
          <ol className="builder-blocks">
            {blocks.map((b, i) => {
              return (
                <li
                  key={b.id}
                  className={`${dropAt === i ? 'drop-before' : ''}${dropAt === i + 1 && i === blocks.length - 1 ? ' drop-after' : ''}`}
                  onDragOver={overBlock(i)}
                >
                  <BlockCard
                    block={b}
                    tasks={lesson.tasks.filter((t) => t.blockId === b.id)}
                    startsAt={starts[i]}
                    first={i === 0}
                    last={i === blocks.length - 1}
                    onMove={(by) => moveTo(b.id, by < 0 ? i - 1 : i + 2)}
                    onDragStart={() => (dragging.current = { blockId: b.id })}
                    onDragEnd={endDrag}
                    onError={fail}
                  />
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

/** One block: its name, length and notes save as you type; its prep can be ticked off here. */
function BlockCard({
  block,
  tasks,
  startsAt,
  first,
  last,
  onMove,
  onDragStart,
  onDragEnd,
  onError
}: {
  block: LessonBlock
  tasks: Lesson['tasks']
  startsAt: number
  first: boolean
  last: boolean
  onMove: (by: -1 | 1) => void
  onDragStart: () => void
  onDragEnd: () => void
  onError: (e: unknown) => void
}): React.JSX.Element {
  const kind = blockKind(block.kind)
  const info = BLOCK_INFO[kind]
  const [open, setOpen] = useState(block.details !== '')
  const { draft, set, flush } = useAutosave(
    {
      title: block.title,
      minutes: block.minutes === null ? '' : String(block.minutes),
      details: block.details
    },
    (patch) => {
      const { minutes, ...rest } = patch
      return window.api.lessons.updateBlock(block.id, {
        ...rest,
        ...(minutes !== undefined ? { minutes: minutes === '' ? null : Number(minutes) } : {})
      })
    },
    onError
  )
  const length = block.minutes ?? 0

  return (
    <div className={`block-card ${kindClass(kind)}`}>
      <div className="block-row">
        <span
          className="block-grip"
          draggable
          onDragStart={(e) => {
            onDragStart()
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', block.title)
            // Drag the whole card, not just the grip.
            const card = e.currentTarget.closest('.block-card')
            if (card) e.dataTransfer.setDragImage(card, 16, 16)
          }}
          onDragEnd={onDragEnd}
          title="Drag to move"
          aria-hidden="true"
        >
          ⠿
        </span>
        <span className="block-time hint">
          {clock(startsAt)}
          {length > 0 && `–${clock(startsAt + length)}`}
        </span>
        <span className="block-kind">{info.label}</span>
        <input
          className="block-title"
          aria-label={`${info.label}: title`}
          value={draft.title}
          placeholder={info.label}
          onChange={(e) => set('title', e.target.value)}
          onBlur={flush}
        />
        <label className="block-minutes">
          <input
            type="number"
            min={0}
            max={600}
            step={5}
            aria-label={`${info.label}: minutes`}
            value={draft.minutes}
            onChange={(e) => set('minutes', e.target.value)}
            onBlur={flush}
          />
          <span className="hint">min</span>
        </label>
        <div className="block-actions">
          <button
            className="btn btn-quiet"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            title="Notes for this part"
          >
            Notes
          </button>
          <button
            className="btn btn-quiet"
            disabled={first}
            onClick={() => onMove(-1)}
            aria-label={`Move ${draft.title || info.label} up`}
          >
            ↑
          </button>
          <button
            className="btn btn-quiet"
            disabled={last}
            onClick={() => onMove(1)}
            aria-label={`Move ${draft.title || info.label} down`}
          >
            ↓
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => window.api.lessons.deleteBlock(block.id).catch(onError)}
            aria-label={`Remove ${draft.title || info.label}`}
            title={tasks.length > 0 ? 'Remove this part and its prep tasks' : 'Remove this part'}
          >
            ✕
          </button>
        </div>
      </div>
      {open && (
        <textarea
          className="block-details"
          rows={2}
          aria-label={`${info.label}: notes`}
          placeholder="Questions to ask, pages, materials… (for you; never on a slide)"
          value={draft.details}
          onChange={(e) => set('details', e.target.value)}
          onBlur={flush}
        />
      )}
      {tasks.length > 0 && (
        <ul className="block-tasks">
          {tasks.map((t) => (
            <li key={t.id}>
              <label className={`check${t.done ? ' task-done' : ''}`}>
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={(e) =>
                    window.api.lessons.updateTask(t.id, { done: e.target.checked }).catch(onError)
                  }
                />
                {t.text}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
