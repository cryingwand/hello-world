import { useEffect, useMemo, useState } from 'react'
import type { ClassSummary, Student, Term } from '@shared/models'
import type { ImportResult } from '@shared/roster'
import type { AppProps } from '@apps/types'
import ErrorBanner from '@renderer/components/ErrorBanner'
import Sensitive, { useMasked } from '@renderer/components/Sensitive'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel, studentName } from '@renderer/lib/labels'
import { useShell } from '@renderer/shell/ShellContext'
import AddExistingDialog from './AddExistingDialog'
import ClassForm from './ClassForm'
import ImportWizard from './ImportWizard'
import StudentForm from './StudentForm'
import TermForm from './TermForm'

type Dialog =
  | { kind: 'term'; term?: Term }
  | { kind: 'class'; edit: boolean; termId?: number }
  | { kind: 'student'; student?: Student; enrollInClassId?: number | null }
  | { kind: 'add-existing' }
  | { kind: 'import' }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export default function ClassesApp({ intent, intentNonce }: AppProps): React.JSX.Element {
  const { currentClassId, setCurrentClassId, dispatchIntent } = useShell()
  const masked = useMasked()
  const [mode, setMode] = useState<'class' | 'students'>('class')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')

  const terms = useApiQuery(() => window.api.terms.list(), [], ['terms.changed'])
  const classes = useApiQuery(
    () => window.api.classes.list(),
    [],
    ['classes.changed', 'terms.changed', 'enrollments.changed']
  )
  const cls = classes.data?.find((c) => c.id === currentClassId) ?? null

  const roster = useApiQuery(
    () => (currentClassId ? window.api.classes.roster(currentClassId) : Promise.resolve([])),
    [currentClassId],
    ['students.changed', 'enrollments.changed']
  )
  const everyone = useApiQuery(
    // While presenting, typed names and tag filters are ignored so they cannot narrow what is on screen.
    () => window.api.students.list(masked ? {} : { search, tag: tag || undefined }),
    [search, tag, masked],
    ['students.changed']
  )
  const allTags = useApiQuery(() => window.api.students.list(), [], ['students.changed'])

  // The shell can ask this app to open a class (the `open-class` intent). The local view switches
  // during render, keyed on the nonce so a repeated identical intent still applies once.
  const [handledNonce, setHandledNonce] = useState<number | undefined>(undefined)
  if (intent?.type === 'open-class' && intentNonce !== handledNonce) {
    setHandledNonce(intentNonce)
    setMode('class')
  }
  useEffect(() => {
    if (intent?.type === 'open-class') setCurrentClassId(intent.classId)
  }, [intent, intentNonce, setCurrentClassId])

  const termGroups = useMemo(() => {
    const byTerm = new Map<number, ClassSummary[]>()
    for (const c of classes.data ?? []) byTerm.set(c.termId, [...(byTerm.get(c.termId) ?? []), c])
    return (terms.data ?? []).map((t) => ({ term: t, classes: byTerm.get(t.id) ?? [] }))
  }, [classes.data, terms.data])

  const tagOptions = useMemo(
    () => [...new Set((allTags.data ?? []).flatMap((s) => s.tags))].sort(),
    [allTags.data]
  )

  const guard = (p: Promise<unknown>): void => {
    p.catch((e: unknown) => setError(msg(e)))
  }
  const close = (): void => setDialog(null)
  const onImported = (r: ImportResult): void => {
    setCurrentClassId(r.classId)
    setMode('class')
    setDialog(null)
    setNotice(
      `Imported ${r.created} new student${r.created === 1 ? '' : 's'}` +
        (r.enrolledExisting ? `, added ${r.enrolledExisting} existing` : '') +
        (r.skipped ? `, skipped ${r.skipped}` : '')
    )
  }
  const exportRoster = (format: 'xlsx' | 'csv'): void => {
    if (!cls) return
    window.api.roster
      .exportClass(cls.id, format)
      .then((r) => r && setNotice(`Saved ${r.path}`))
      .catch((e: unknown) => setError(msg(e)))
  }

  return (
    <div className="split">
      <aside className="sidebar" aria-label="Terms and classes">
        <div className="sidebar-actions">
          <button className="btn" onClick={() => setDialog({ kind: 'term' })}>
            + Term
          </button>
          <button
            className="btn"
            onClick={() => setDialog({ kind: 'class', edit: false })}
            disabled={(terms.data ?? []).length === 0}
            title={(terms.data ?? []).length === 0 ? 'Create a term first' : undefined}
          >
            + Class
          </button>
        </div>
        <button
          className={`side-item${mode === 'students' ? ' side-active' : ''}`}
          onClick={() => setMode('students')}
        >
          All students
        </button>
        {termGroups.map(({ term, classes: list }) => (
          <div key={term.id} className="term-group">
            <div className="term-head">
              <span>
                {term.name}
                {term.isCurrent && <span className="badge">current</span>}
              </span>
              <button
                className="btn btn-quiet"
                onClick={() => setDialog({ kind: 'term', term })}
                aria-label={`Edit ${term.name}`}
              >
                Edit
              </button>
            </div>
            {list.map((c) => (
              <button
                key={c.id}
                className={`side-item${mode === 'class' && c.id === currentClassId ? ' side-active' : ''}`}
                onClick={() => {
                  setCurrentClassId(c.id)
                  setMode('class')
                }}
              >
                <span>{classLabel(c)}</span>
                <span className="count">{c.studentCount}</span>
              </button>
            ))}
            {list.length === 0 && <div className="hint side-empty">No classes</div>}
          </div>
        ))}
        {(terms.data ?? []).length === 0 && !terms.loading && (
          <p className="hint side-empty">Start by creating a term, then a class.</p>
        )}
      </aside>

      <section className="pane">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        {notice && (
          <div className="notice-bar" role="status">
            <span>{notice}</span>
            <button className="btn btn-quiet" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        {mode === 'students' ? (
          <>
            <div className="pane-head">
              <h2>All students</h2>
              <div className="actions">
                <button className="btn btn-primary" onClick={() => setDialog({ kind: 'student' })}>
                  + Student
                </button>
              </div>
            </div>
            <div className="toolbar">
              <input
                className="search"
                placeholder="Search name or email"
                value={masked ? '' : search}
                disabled={masked}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search students"
              />
              <select
                value={masked ? '' : tag}
                disabled={masked}
                onChange={(e) => setTag(e.target.value)}
                aria-label="Filter by tag"
              >
                <option value="">All tags</option>
                {(masked ? [] : tagOptions).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <StudentTable
              students={everyone.data ?? []}
              onOpen={(s) => setDialog({ kind: 'student', student: s })}
              empty="No students yet. Add one, or import a roster into a class."
            />
          </>
        ) : cls ? (
          <>
            <div className="pane-head">
              <div>
                <h2>{classLabel(cls)}</h2>
                <div className="hint">
                  {cls.termName} ·{' '}
                  {cls.gradingMode === 'weighted' ? 'Weighted categories' : 'Total points'} ·{' '}
                  {cls.studentCount} student{cls.studentCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="actions">
                <button className="btn" onClick={() => setDialog({ kind: 'class', edit: true })}>
                  Edit class
                </button>
                <button className="btn" onClick={() => exportRoster('xlsx')}>
                  Export .xlsx
                </button>
                <button className="btn" onClick={() => exportRoster('csv')}>
                  Export .csv
                </button>
                <button className="btn" onClick={() => setDialog({ kind: 'import' })}>
                  Import roster…
                </button>
                <button className="btn" onClick={() => setDialog({ kind: 'add-existing' })}>
                  Add existing
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setDialog({ kind: 'student', enrollInClassId: cls.id })}
                >
                  + New student
                </button>
              </div>
            </div>
            <StudentTable
              students={roster.data ?? []}
              onOpen={(s) => setDialog({ kind: 'student', student: s })}
              onRemove={(s) => {
                if (
                  window.confirm(
                    'Remove this student from the class? Their scores in this class are deleted; they stay in your student list.'
                  )
                ) {
                  guard(window.api.classes.unenroll(cls.id, s.id))
                }
              }}
              empty="No students in this class yet. Import a roster or add students."
            />
          </>
        ) : (
          <div className="placeholder">
            <strong>No class selected</strong>
            <span>Pick a class on the left, or create one.</span>
            {(classes.data ?? []).length === 0 &&
              !classes.loading &&
              (terms.data ?? []).length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={() => setDialog({ kind: 'class', edit: false })}
                >
                  + Class
                </button>
              )}
            <button className="btn" onClick={() => setDialog({ kind: 'import' })}>
              Import roster…
            </button>
          </div>
        )}
      </section>

      {dialog?.kind === 'term' && <TermForm term={dialog.term} onClose={close} onSaved={close} />}
      {dialog?.kind === 'class' && (
        <ClassForm
          cls={dialog.edit && cls ? cls : undefined}
          terms={terms.data ?? []}
          defaultTermId={dialog.termId}
          onClose={close}
          onSaved={(c) => {
            setCurrentClassId(c.id)
            setMode('class')
            close()
          }}
          onDeleted={() => {
            setCurrentClassId(null)
            close()
          }}
        />
      )}
      {dialog?.kind === 'student' && (
        <StudentForm
          student={dialog.student}
          enrollInClassId={dialog.enrollInClassId}
          onOpenGradebook={(studentId) => {
            // Only name a class if they are in the one on screen; the Gradebook picks one otherwise.
            const inThisClass =
              mode === 'class' && (roster.data ?? []).some((s) => s.id === studentId)
            dispatchIntent({
              type: 'open-student',
              studentId,
              classId: inThisClass ? (currentClassId ?? undefined) : undefined
            })
            close()
          }}
          onClose={close}
          onSaved={close}
        />
      )}
      {dialog?.kind === 'add-existing' && cls && (
        <AddExistingDialog classId={cls.id} onClose={close} />
      )}
      {dialog?.kind === 'import' && (
        <ImportWizard
          classes={classes.data ?? []}
          terms={terms.data ?? []}
          defaultClassId={currentClassId}
          onClose={close}
          onDone={onImported}
        />
      )}
    </div>
  )
}

function StudentTable({
  students,
  onOpen,
  onRemove,
  empty
}: {
  students: Student[]
  onOpen: (s: Student) => void
  onRemove?: (s: Student) => void
  empty: string
}): React.JSX.Element {
  if (students.length === 0) return <p className="hint pad">{empty}</p>
  return (
    <div className="table-scroll">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Tags</th>
            {onRemove && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id} className="clickable" onClick={() => onOpen(s)}>
              <td>
                <Sensitive>{studentName(s)}</Sensitive>
              </td>
              <td>
                <Sensitive>{s.email}</Sensitive>
              </td>
              <td>
                <Sensitive placeholder="•">
                  {s.tags.map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                </Sensitive>
              </td>
              {onRemove && (
                <td className="right">
                  <button
                    className="btn btn-quiet"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(s)
                    }}
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
