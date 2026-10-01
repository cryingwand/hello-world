import { useState } from 'react'
import { formatDate } from '@shared/advising'
import type { UnitSummary } from '@shared/models'
import { useApiQuery } from '@renderer/data/hooks'
import UnitEditor from './UnitEditor'
import UnitForm from './UnitForm'
import UpcomingList from './UpcomingList'

type Tab = 'units' | 'upcoming'

export default function PlannerApp(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('units')
  const [unitId, setUnitId] = useState<number | null>(null)
  const [lessonId, setLessonId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const units = useApiQuery(() => window.api.units.list(), [], ['planner.changed'])
  const list = units.data ?? []
  const current = list.find((u) => u.id === unitId)

  const tabButton = (k: Tab, label: string): React.JSX.Element => (
    <button
      role="tab"
      aria-selected={tab === k}
      className={tab === k ? 'tab tab-on' : 'tab'}
      onClick={() => setTab(k)}
    >
      {label}
    </button>
  )

  // Units are listed under their course, in the order the list arrives.
  const groups: { course: string; units: UnitSummary[] }[] = []
  for (const u of list) {
    const last = groups[groups.length - 1]
    if (last && last.course === u.course) last.units.push(u)
    else groups.push({ course: u.course, units: [u] })
  }

  return (
    <div className="quiz-app">
      <div className="tabs quiz-tabs" role="tablist">
        {tabButton('units', 'Units')}
        {tabButton('upcoming', 'Coming up')}
      </div>
      <div className="quiz-body">
        {tab === 'upcoming' ? (
          <UpcomingList
            onOpen={(u, l) => {
              setUnitId(u)
              setLessonId(l)
              setTab('units')
            }}
          />
        ) : (
          <div className="split">
            <aside className="sidebar" aria-label="Units">
              <div className="sidebar-actions">
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  + Unit
                </button>
              </div>
              {groups.map((g) => (
                <div key={g.course} className="term-group">
                  <div className="term-head">{g.course || 'No course'}</div>
                  {g.units.map((u) => (
                    <button
                      key={u.id}
                      className={`side-item quiz-side${current?.id === u.id ? ' side-active' : ''}`}
                      onClick={() => {
                        setUnitId(u.id)
                        setLessonId(null)
                      }}
                    >
                      <span className="quiz-side-text">
                        <span className="adv-side-name">{u.title}</span>
                        <span className="hint quiz-side-meta">
                          {u.firstDate ? formatDate(u.firstDate) : 'No dates yet'}
                          {u.lastDate &&
                            u.lastDate !== u.firstDate &&
                            ` – ${formatDate(u.lastDate)}`}
                        </span>
                      </span>
                      <span className="count">{u.lessonCount}</span>
                    </button>
                  ))}
                </div>
              ))}
              {list.length === 0 && !units.loading && (
                <p className="hint side-empty">No units yet.</p>
              )}
            </aside>
            <section className="pane">
              {units.error && <p className="hint">{units.error}</p>}
              {current ? (
                <UnitEditor
                  key={current.id}
                  unitId={current.id}
                  lessonId={lessonId}
                  onSelectLesson={setLessonId}
                  onDeleted={() => {
                    setUnitId(null)
                    setLessonId(null)
                  }}
                />
              ) : (
                <div className="placeholder">
                  <strong>{list.length > 0 ? 'Choose a unit' : 'No units yet'}</strong>
                  <span>
                    {list.length > 0
                      ? 'Pick one on the left to plan its lessons.'
                      : 'Create a unit, then add the lessons in it.'}
                  </span>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {creating && (
        <UnitForm
          defaultCourse={current?.course ?? list[0]?.course ?? ''}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setTab('units')
            setUnitId(id)
            setLessonId(null)
          }}
        />
      )}
    </div>
  )
}
