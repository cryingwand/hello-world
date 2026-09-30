import { useEffect, useState } from 'react'
import type { Assignment } from '@shared/models'
import type { ScoreImportResult } from '@shared/scoreImport'
import type { AppProps } from '@apps/types'
import ErrorBanner from '@renderer/components/ErrorBanner'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'
import { useShell } from '@renderer/shell/ShellContext'
import AssignmentForm from './AssignmentForm'
import ScoreGrid, { type FocusRequest } from './ScoreGrid'
import ScoreImportWizard from './ScoreImportWizard'
import SetupTab from './SetupTab'
import StudentDetail from './StudentDetail'
import { useGradebook } from './useGradebook'

type View = { kind: 'grid' } | { kind: 'setup' } | { kind: 'student'; studentId: number }
type Dialog = { kind: 'assignment'; assignment?: Assignment } | { kind: 'import' }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export default function GradebookApp({ intent, intentNonce }: AppProps): React.JSX.Element {
  const { currentClassId, setCurrentClassId } = useShell()
  const [view, setView] = useState<View>({ kind: 'grid' })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<{ text: string; path?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusRequest | undefined>(undefined)

  const classes = useApiQuery(
    () => window.api.classes.list(),
    [],
    ['classes.changed', 'terms.changed', 'enrollments.changed']
  )
  const gb = useGradebook(currentClassId)
  const data = gb.data

  // Intents from other apps. The view changes during render (keyed on the nonce); resolving which
  // class a student belongs to needs the API, so that part runs in an effect and sets state async.
  const [handled, setHandled] = useState<number | undefined>(undefined)
  if (intent && intentNonce !== handled) {
    if (intent.type === 'open-student') {
      setHandled(intentNonce)
      setView({ kind: 'student', studentId: intent.studentId })
    } else if (intent.type === 'record-score') {
      setHandled(intentNonce)
      setView({ kind: 'grid' })
      setFocus({
        assignmentId: intent.assignmentId,
        studentId: intent.studentId,
        nonce: intentNonce ?? 0
      })
    }
  }
  useEffect(() => {
    if (!intent) return
    if (intent.type === 'record-score' && intent.classId) setCurrentClassId(intent.classId)
    if (intent.type !== 'open-student') return
    if (intent.classId) {
      setCurrentClassId(intent.classId)
      return
    }
    // No class given: stay in the current class if they are in it, otherwise use their first class.
    window.api.classes
      .forStudent(intent.studentId)
      .then((list) => {
        if (list.length > 0 && !list.some((c) => c.id === currentClassId))
          setCurrentClassId(list[0].id)
      })
      .catch((e: unknown) => setError(msg(e)))
    // Only a new intent should trigger this, not a class change it caused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, intentNonce])

  const exportScores = (format: 'xlsx' | 'csv'): void => {
    if (!data) return
    window.api.gradebook
      .exportClass(data.cls.id, format)
      .then((r) => r && setNotice({ text: `Saved ${r.path}`, path: r.path }))
      .catch((e: unknown) => setError(msg(e)))
  }
  const openInExcel = (path: string): void => {
    window.api.files
      .open({ path, app: 'Microsoft Excel', snap: true })
      .then((r) => {
        if (!r.opened || r.message)
          setNotice({ text: r.message ?? 'Could not open in Excel', path })
      })
      .catch((e: unknown) => setError(msg(e)))
  }
  const imported = (r: ScoreImportResult): void => {
    setDialog(null)
    setView({ kind: 'grid' })
    setNotice({
      text:
        `Imported ${r.scoresWritten} scores` +
        (r.createdAssignments
          ? `, created ${r.createdAssignments} assignment${r.createdAssignments === 1 ? '' : 's'}`
          : '') +
        (r.skippedRows
          ? `, ${r.skippedRows} row${r.skippedRows === 1 ? '' : 's'} not matched`
          : '') +
        (r.invalidCells ? `, ${r.invalidCells} cell${r.invalidCells === 1 ? '' : 's'} skipped` : '')
    })
  }

  const tab = (k: 'grid' | 'setup', label: string): React.JSX.Element => (
    <button
      role="tab"
      aria-selected={view.kind === k}
      className={view.kind === k ? 'tab tab-on' : 'tab'}
      onClick={() => setView({ kind: k })}
    >
      {label}
    </button>
  )

  return (
    <div className="gb">
      <div className="gb-head">
        <select
          className="class-select"
          aria-label="Class"
          value={data ? data.cls.id : (currentClassId ?? '')}
          onChange={(e) => setCurrentClassId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Choose a class…</option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)} ({c.termName})
            </option>
          ))}
        </select>
        <div className="tabs" role="tablist">
          {tab('grid', 'Scores')}
          {tab('setup', 'Setup')}
        </div>
        <span className="spacer" />
        {data && (
          <div className="actions">
            <button className="btn" onClick={() => setDialog({ kind: 'assignment' })}>
              + Assignment
            </button>
            <button className="btn" onClick={() => setDialog({ kind: 'import' })}>
              Import scores…
            </button>
            <button className="btn" onClick={() => exportScores('xlsx')}>
              Export .xlsx
            </button>
            <button className="btn" onClick={() => exportScores('csv')}>
              Export .csv
            </button>
          </div>
        )}
      </div>

      <div className="gb-body">
        <ErrorBanner
          message={error ?? gb.error}
          onDismiss={() => {
            setError(null)
            gb.clearError()
          }}
        />
        {notice && (
          <div className="notice-bar" role="status">
            <span>{notice.text}</span>
            <span className="row">
              {notice.path && (
                <>
                  <button className="btn" onClick={() => openInExcel(notice.path!)}>
                    Open in Excel
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      window.api.files.reveal(notice.path!).catch((e: unknown) => setError(msg(e)))
                    }
                  >
                    Show in Finder
                  </button>
                </>
              )}
              <button className="btn btn-quiet" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </span>
          </div>
        )}

        {!data ? (
          <div className="placeholder">
            <strong>{currentClassId ? 'Loading…' : 'Choose a class'}</strong>
            <span>
              {currentClassId
                ? ''
                : 'Pick a class above to see its scores. Create classes in Classes & Rosters.'}
            </span>
          </div>
        ) : view.kind === 'setup' ? (
          <SetupTab
            data={data}
            onEditAssignment={(a) => setDialog({ kind: 'assignment', assignment: a })}
            onNewAssignment={() => setDialog({ kind: 'assignment' })}
          />
        ) : view.kind === 'student' ? (
          <StudentDetail
            studentId={view.studentId}
            data={data}
            onSave={gb.saveScore}
            onBack={() => setView({ kind: 'grid' })}
            onChangeClass={setCurrentClassId}
          />
        ) : (
          <ScoreGrid
            data={data}
            onSave={gb.saveScore}
            onOpenStudent={(id) => setView({ kind: 'student', studentId: id })}
            onEditAssignment={(a) => setDialog({ kind: 'assignment', assignment: a })}
            focusRequest={focus}
          />
        )}
      </div>

      {dialog?.kind === 'assignment' && data && (
        <AssignmentForm
          classId={data.cls.id}
          assignment={dialog.assignment}
          categories={data.categories}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'import' && data && (
        <ScoreImportWizard data={data} onClose={() => setDialog(null)} onDone={imported} />
      )}
    </div>
  )
}
