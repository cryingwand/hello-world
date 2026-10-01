import { useState } from 'react'
import { formatDate } from '@shared/advising'
import { formatMinutes, plannedMinutes } from '@shared/lessonBlocks'
import { dateSpan } from '@shared/lesson'
import { useApiQuery } from '@renderer/data/hooks'
import { KindMix, RoadmapBar } from './RoadmapBar'

/** Which semester to show: a term id, or "none" for the units not in one. */
type Pick = number | 'none'

/**
 * The semester as a roadmap: each unit is a lane, in the order it is taught, with its lessons as
 * cards along it. Every card shows the lesson's blocks, so the shape of the term (too much lecture,
 * no review before the exam) shows at a glance. A card opens its lesson.
 */
export default function SemesterView({
  onOpen,
  onNewUnit
}: {
  onOpen: (unitId: number, lessonId: number | null) => void
  onNewUnit: (termId: number | null) => void
}): React.JSX.Element {
  const terms = useApiQuery(() => window.api.terms.list(), [], ['terms.changed'])
  const [chosen, setChosen] = useState<Pick | null>(null)
  const list = terms.data ?? []
  // The current term until another is chosen; a chosen term that was deleted falls back to it too.
  const fallback: Pick = list.find((t) => t.isCurrent)?.id ?? list[0]?.id ?? 'none'
  const pick: Pick =
    chosen === 'none' || (chosen !== null && list.some((t) => t.id === chosen)) ? chosen : fallback
  const termId = pick === 'none' ? null : pick
  const term = list.find((t) => t.id === termId)

  const roadmap = useApiQuery(
    () => window.api.units.roadmap(termId),
    [termId],
    ['planner.changed', 'terms.changed']
  )
  const units = roadmap.data ?? []
  const blocks = units.flatMap((u) => u.lessons.flatMap((l) => l.blocks))
  const lessons = units.reduce((n, u) => n + u.lessons.length, 0)

  return (
    <section className="pane semester">
      <div className="pane-head">
        <div>
          <h2>Semester roadmap</h2>
          <div className="hint">
            {term && (term.startDate || term.endDate)
              ? `${dateSpan(term.startDate, term.endDate)} · `
              : ''}
            {units.length} {units.length === 1 ? 'unit' : 'units'} · {lessons}{' '}
            {lessons === 1 ? 'lesson' : 'lessons'}
            {blocks.length > 0 && ` · ${formatMinutes(plannedMinutes(blocks))} planned`}
          </div>
        </div>
        <div className="actions">
          <select
            aria-label="Semester"
            value={pick}
            onChange={(e) => setChosen(e.target.value === 'none' ? 'none' : Number(e.target.value))}
          >
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isCurrent ? ' (current)' : ''}
              </option>
            ))}
            <option value="none">Units with no semester</option>
          </select>
          <button className="btn btn-primary" onClick={() => onNewUnit(termId)}>
            + Unit
          </button>
        </div>
      </div>
      {roadmap.error && <p className="hint">{roadmap.error}</p>}
      <KindMix blocks={blocks} />

      {units.length === 0 && !roadmap.loading ? (
        <div className="placeholder">
          <strong>No units here yet</strong>
          <span>
            {list.length === 0
              ? 'Add a term in Classes & Rosters to plan a semester, or add a unit with no semester.'
              : 'Add a unit, or choose this semester in an existing unit’s details.'}
          </span>
        </div>
      ) : (
        <div className="lanes">
          {units.map((u) => {
            const dates = u.lessons
              .map((l) => l.date)
              .filter((d): d is string => !!d)
              .sort()
            return (
              <div key={u.id} className="lane">
                <button className="lane-head" onClick={() => onOpen(u.id, null)}>
                  <strong>{u.title}</strong>
                  <span className="hint">
                    {[u.course, dates.length > 0 ? dateSpan(dates[0], dates.at(-1)!) : '']
                      .filter((p) => p !== '')
                      .join(' · ')}
                  </span>
                  <span className="hint">
                    {u.lessons.length} {u.lessons.length === 1 ? 'lesson' : 'lessons'}
                  </span>
                </button>
                <ol className="lane-cards">
                  {u.lessons.map((l) => {
                    const open = l.tasks.filter((t) => !t.done).length
                    return (
                      <li key={l.id}>
                        <button className="lane-card" onClick={() => onOpen(u.id, l.id)}>
                          <span className="hint lane-date">
                            {l.date ? formatDate(l.date) : 'No date'}
                          </span>
                          <span className="lane-title">{l.title}</span>
                          <RoadmapBar blocks={l.blocks} classMinutes={l.classMinutes} />
                          <span className="hint lane-meta">
                            {l.blocks.length === 0
                              ? 'Not built yet'
                              : formatMinutes(plannedMinutes(l.blocks))}
                            {open > 0 && ` · ${open} to do`}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                  {u.lessons.length === 0 && <li className="hint lane-none">No lessons yet</li>}
                </ol>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
