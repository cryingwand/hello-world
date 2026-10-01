import { useState } from 'react'
import { formatDate } from '@shared/advising'
import type { UnitDetail } from '@shared/models'
import ErrorBanner from '@renderer/components/ErrorBanner'
import { useApiQuery } from '@renderer/data/hooks'
import AttachedFiles from './AttachedFiles'
import CopyUnitDialog from './CopyUnitDialog'
import LessonEditor from './LessonEditor'
import { KindMix, RoadmapBar } from './RoadmapBar'
import { useAutosave } from './useAutosave'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const openTasks = (l: { tasks: { done: boolean }[] }): number =>
  l.tasks.filter((t) => !t.done).length

/** One unit: its details, its lessons in order, the PowerPoint export and the selected lesson. */
export default function UnitEditor({
  unitId,
  lessonId,
  onSelectLesson,
  onDeleted,
  onCopied,
  onMoved
}: {
  unitId: number
  lessonId: number | null
  onSelectLesson: (id: number | null) => void
  onDeleted: () => void
  /** A copy of the unit was made: show it. */
  onCopied: (unitId: number) => void
  /** A lesson was moved to another unit: show it there. */
  onMoved: (unitId: number, lessonId: number) => void
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [exporting, setExporting] = useState<'unit' | 'lesson' | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const unit = useApiQuery(
    () => window.api.units.get(unitId),
    [unitId],
    // A deleted term clears the unit's semester without a planner event.
    [
      'planner.changed',
      'quizzes.changed',
      'classes.changed',
      'assignments.changed',
      'terms.changed'
    ]
  )
  const u = unit.data
  if (!u) {
    return (
      <div className="placeholder">
        <strong>{unit.loading ? 'Loading…' : 'That unit no longer exists'}</strong>
      </div>
    )
  }

  const fail = (e: unknown): void => setError(msg(e))
  const selected = u.lessons.find((l) => l.id === lessonId) ?? null
  const move = (index: number, by: -1 | 1): void => {
    const ids = u.lessons.map((l) => l.id)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    window.api.units.reorder(u.id, ids).catch(fail)
  }
  const addLesson = (): void => {
    window.api.lessons
      .create({ unitId: u.id, title: `Lesson ${u.lessons.length + 1}` })
      .then((made) => onSelectLesson(made.id))
      .catch(fail)
  }
  const exportDeck = (which: 'unit' | 'lesson'): void => {
    setExporting(which)
    setSaved(null)
    window.api.units
      .exportPowerPoint(u.id, which === 'lesson' ? (selected?.id ?? null) : null)
      .then((res) => setSaved(res?.path ?? null))
      .catch(fail)
      .finally(() => setExporting(null))
  }
  const remove = (): void => {
    if (
      !window.confirm(
        `Delete “${u.title}” and its ${u.lessons.length} ${u.lessons.length === 1 ? 'lesson' : 'lessons'}? Attached files stay on disk and quizzes are not touched.`
      )
    )
      return
    window.api.units.delete(u.id).then(onDeleted).catch(fail)
  }

  return (
    <>
      <ErrorBanner message={error ?? unit.error} onDismiss={() => setError(null)} />
      <div className="pane-head">
        <div>
          <h2>{u.title}</h2>
          <div className="hint">
            {u.course && `${u.course} · `}
            {u.lessons.length} {u.lessons.length === 1 ? 'lesson' : 'lessons'}
          </div>
        </div>
        <div className="actions">
          <button
            className="btn btn-primary"
            disabled={u.lessons.length === 0 || exporting !== null}
            onClick={() => exportDeck('unit')}
          >
            {exporting === 'unit' ? 'Saving…' : 'PowerPoint for the unit'}
          </button>
          <button className="btn" onClick={() => setCopying(true)}>
            Copy unit…
          </button>
          <button className="btn btn-danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>
      {saved && (
        <p className="hint">
          Saved to {saved}{' '}
          <button className="link" onClick={() => window.api.files.reveal(saved).catch(fail)}>
            Show in folder
          </button>
        </p>
      )}

      <UnitDetails key={u.id} unit={u} onError={(e) => setError(msg(e))} />

      <section className="adv-section">
        <h3>
          Lessons
          <button className="btn" onClick={addLesson}>
            + Lesson
          </button>
        </h3>
        <KindMix blocks={u.lessons.flatMap((l) => l.blocks)} />
        {u.lessons.length === 0 ? (
          <p className="hint">No lessons yet. Add one to start planning.</p>
        ) : (
          <ol className="pl-list">
            {u.lessons.map((l, i) => (
              <li key={l.id} className={`pl-item${l.id === selected?.id ? ' pl-item-on' : ''}`}>
                <button
                  className="pl-open"
                  aria-current={l.id === selected?.id}
                  onClick={() => onSelectLesson(l.id)}
                >
                  <span className="pl-name">{l.title}</span>
                  <span className="hint pl-meta">
                    {l.date ? formatDate(l.date) : 'No date'}
                    {l.quizzes.length > 0 &&
                      ` · ${l.quizzes.length} ${l.quizzes.length === 1 ? 'quiz' : 'quizzes'}`}
                    {openTasks(l) > 0 && ` · ${openTasks(l)} to do`}
                  </span>
                  <RoadmapBar blocks={l.blocks} classMinutes={l.classMinutes} />
                </button>
                <button
                  className="btn btn-quiet"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${l.title} up`}
                >
                  Up
                </button>
                <button
                  className="btn btn-quiet"
                  disabled={i === u.lessons.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${l.title} down`}
                >
                  Down
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {selected && (
        <LessonEditor
          key={selected.id}
          lesson={selected}
          onError={(m) => setError(m)}
          unitId={u.id}
          course={u.course}
          onDeleted={() => onSelectLesson(null)}
          onCopied={(id) => onSelectLesson(id)}
          onMoved={(unit) => onMoved(unit, selected.id)}
          onExport={() => exportDeck('lesson')}
          exporting={exporting === 'lesson'}
        />
      )}

      <AttachedFiles recordType="unit" recordId={u.id} onError={(m) => setError(m)} />

      {copying && (
        <CopyUnitDialog
          unit={u}
          onClose={() => setCopying(false)}
          onCopied={(id) => {
            setCopying(false)
            onCopied(id)
          }}
        />
      )}

      <p className="hint">
        A saved PowerPoint is an ordinary file, with your lesson notes as speaker notes and the
        names (not the questions) of any quizzes. Save it inside a protected folder to keep it out
        of file search and the Presenter.
      </p>
    </>
  )
}

/** The unit's own fields. Each saves as you type. */
function UnitDetails({
  unit,
  onError
}: {
  unit: UnitDetail
  onError: (e: unknown) => void
}): React.JSX.Element {
  const { draft, set, flush } = useAutosave(
    { title: unit.title, course: unit.course, summary: unit.summary },
    (patch) => window.api.units.update(unit.id, patch),
    onError
  )
  const terms = useApiQuery(() => window.api.terms.list(), [], ['terms.changed'])
  return (
    <section className="adv-section">
      <h3>Unit details</h3>
      <div className="form">
        <div className="form-row">
          <label className="pl-grow">
            Title
            <input
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              onBlur={flush}
            />
          </label>
          <label>
            Course
            <input
              value={draft.course}
              onChange={(e) => set('course', e.target.value)}
              onBlur={flush}
            />
          </label>
          <label>
            Semester
            <select
              value={unit.termId ?? ''}
              onChange={(e) =>
                window.api.units
                  .update(unit.id, { termId: e.target.value ? Number(e.target.value) : null })
                  .catch(onError)
              }
            >
              <option value="">None</option>
              {(terms.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Overview (one point per line)
          <textarea
            rows={3}
            value={draft.summary}
            onChange={(e) => set('summary', e.target.value)}
            onBlur={flush}
          />
        </label>
      </div>
    </section>
  )
}
