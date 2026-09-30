import { useMemo, useState } from 'react'
import { FIELD_LABELS, type TableFile } from '@shared/roster'
import { formatPoints } from '@shared/grades'
import type { ScoreImportPlan, ScoreImportRequest, ScoreImportResult } from '@shared/scoreImport'
import { detectScoreColumns, parseColumnHeader } from '@shared/scoreImport'
import Modal from '@renderer/components/Modal'
import { columnLetter } from '@renderer/lib/labels'
import type { GradebookData } from './useGradebook'

interface Col {
  index: number
  header: string
  include: boolean
  title: string
  points: string
  categoryId: number | null
}
type Ident = {
  firstName: number | null
  lastName: number | null
  fullName: number | null
  email: number | null
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const normTitle = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const IDENT_FIELDS = ['firstName', 'lastName', 'fullName', 'email'] as const

export default function ScoreImportWizard({
  data,
  onClose,
  onDone
}: {
  data: GradebookData
  onClose: () => void
  onDone: (r: ScoreImportResult) => void
}): React.JSX.Element {
  const { cls, assignments, categories } = data
  const [file, setFile] = useState<TableFile | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [pointsRow, setPointsRow] = useState(false)
  const [ident, setIdent] = useState<Ident>({
    firstName: null,
    lastName: null,
    fullName: null,
    email: null
  })
  const [cols, setCols] = useState<Col[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [step, setStep] = useState<'map' | 'preview'>('map')
  const [plan, setPlan] = useState<ScoreImportPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existingByTitle = useMemo(
    () => new Map(assignments.map((a) => [normTitle(a.title), a])),
    [assignments]
  )
  const width = useMemo(
    () => (file ? Math.max(0, ...file.rows.slice(0, 50).map((r) => r.length)) : 0),
    [file]
  )

  const analyse = (f: TableFile, header: boolean, pRow: boolean): void => {
    const d = detectScoreColumns(f.rows, header, pRow)
    const chosen = new Map(d.mapping.columns.map((c) => [c.index, c]))
    const identCols = new Set([
      d.mapping.firstName,
      d.mapping.lastName,
      d.mapping.fullName,
      d.mapping.email
    ])
    setIdent({
      firstName: d.mapping.firstName,
      lastName: d.mapping.lastName,
      fullName: d.mapping.fullName,
      email: d.mapping.email
    })
    setNotes(d.notes)
    const w = Math.max(0, ...f.rows.slice(0, 50).map((r) => r.length))
    setCols(
      Array.from({ length: w }, (_, i) => i)
        .filter((i) => !identCols.has(i))
        .map((i) => {
          const c = chosen.get(i)
          const headerText = header ? (f.rows[0]?.[i] ?? '') : ''
          const parsed = parseColumnHeader(headerText || `Column ${columnLetter(i)}`)
          return {
            index: i,
            header: headerText || `Column ${columnLetter(i)}`,
            include: !!c,
            title: c?.title ?? parsed.title,
            points: c
              ? c.pointsPossible > 0
                ? String(c.pointsPossible)
                : ''
              : parsed.points !== null
                ? String(parsed.points)
                : '',
            categoryId: null
          }
        })
    )
    setPlan(null)
    setStep('map')
  }

  const choose = async (): Promise<void> => {
    setError(null)
    try {
      const f = await window.api.roster.chooseFile()
      if (f) {
        setFile(f)
        analyse(f, hasHeader, pointsRow)
      }
    } catch (e) {
      setError(msg(e))
    }
  }
  const changeSheet = async (sheet: string): Promise<void> => {
    if (!file) return
    try {
      const f = await window.api.roster.readSheet(file.token, sheet)
      setFile(f)
      analyse(f, hasHeader, pointsRow)
    } catch (e) {
      setError(msg(e))
    }
  }
  const update = (index: number, patch: Partial<Col>): void =>
    setCols((cs) => cs.map((c) => (c.index === index ? { ...c, ...patch } : c)))

  const included = cols.filter((c) => c.include)
  const hasStudentColumn = IDENT_FIELDS.some((f) => ident[f] !== null)
  const pointsFor = (c: Col): number | null => {
    if (c.points.trim() === '')
      return existingByTitle.get(normTitle(c.title))?.pointsPossible ?? null
    const n = Number(c.points)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const problem = !hasStudentColumn
    ? 'Choose the column that identifies each student.'
    : included.length === 0
      ? 'Tick at least one column of scores.'
      : included.some((c) => !c.title.trim())
        ? 'Every score column needs a name.'
        : included.some((c) => pointsFor(c) === null)
          ? 'Enter points possible for each new assignment.'
          : null

  const request = (): ScoreImportRequest | null => {
    if (!file || problem) return null
    return {
      token: file.token,
      sheet: file.sheet,
      hasHeader,
      pointsRow,
      classId: cls.id,
      mapping: {
        ...ident,
        columns: included.map((c) => ({
          index: c.index,
          title: c.title.trim(),
          pointsPossible: pointsFor(c) ?? 0,
          categoryId: c.categoryId
        }))
      }
    }
  }

  const runPreview = async (): Promise<void> => {
    const req = request()
    if (!req) return
    setBusy(true)
    setError(null)
    try {
      setPlan(await window.api.gradebook.previewScores(req))
      setStep('preview')
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }
  const commit = async (): Promise<void> => {
    const req = request()
    if (!req) return
    setBusy(true)
    setError(null)
    try {
      onDone(await window.api.gradebook.commitScores(req))
    } catch (e) {
      setError(msg(e))
      setBusy(false)
    }
  }

  const toWrite = plan ? plan.counts.scoresToWrite + plan.counts.newAssignments : 0
  const label = (row: number): string => plan?.rows.find((r) => r.rowNumber === row)?.label ?? ''

  return (
    <Modal
      title="Import scores"
      wide
      error={error}
      onClose={onClose}
      footer={
        <>
          {step === 'preview' && (
            <button className="btn" onClick={() => setStep('map')} disabled={busy}>
              Back
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {step === 'map' ? (
            <button
              className="btn btn-primary"
              onClick={runPreview}
              disabled={!file || !!problem || busy}
              title={problem ?? undefined}
            >
              Preview
            </button>
          ) : (
            <button className="btn btn-primary" onClick={commit} disabled={toWrite === 0 || busy}>
              {busy ? 'Importing…' : `Import ${plan?.counts.scoresToWrite ?? 0} scores`}
            </button>
          )}
        </>
      }
    >
      {step === 'map' && (
        <div className="form">
          <p className="hint">
            Importing into <strong>{cls.course}</strong>. Students are matched to this class’s
            roster by email, then by name. Blank cells never erase a score.
          </p>
          <div className="row">
            <button className="btn" onClick={choose}>
              {file ? 'Choose a different file…' : 'Choose spreadsheet or CSV…'}
            </button>
            {file && <strong>{file.fileName}</strong>}
            {file && file.sheetNames.length > 1 && (
              <label className="inline">
                Sheet
                <select value={file.sheet ?? ''} onChange={(e) => changeSheet(e.target.value)}>
                  {file.sheetNames.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {file && (
            <>
              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={hasHeader}
                    onChange={(e) => {
                      setHasHeader(e.target.checked)
                      analyse(file, e.target.checked, e.target.checked && pointsRow)
                    }}
                  />
                  First row is a header
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={pointsRow}
                    disabled={!hasHeader}
                    onChange={(e) => {
                      setPointsRow(e.target.checked)
                      analyse(file, hasHeader, e.target.checked)
                    }}
                  />
                  Second row lists points possible
                </label>
              </div>

              <fieldset>
                <legend>Who is in each row?</legend>
                <div className="map-grid">
                  {IDENT_FIELDS.map((f) => (
                    <label key={f}>
                      {FIELD_LABELS[f]}
                      <select
                        aria-label={FIELD_LABELS[f]}
                        value={ident[f] ?? ''}
                        onChange={(e) =>
                          setIdent({
                            ...ident,
                            [f]: e.target.value === '' ? null : Number(e.target.value)
                          })
                        }
                      >
                        <option value="">(not in this file)</option>
                        {Array.from({ length: width }, (_, i) => (
                          <option key={i} value={i}>
                            {columnLetter(i)}:{' '}
                            {hasHeader ? (file.rows[0]?.[i] ?? '') : `Column ${columnLetter(i)}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend>Which columns are assignments?</legend>
                {notes.length > 0 && <p className="hint">{notes.join(' · ')}</p>}
                <table className="grid-table compact-table">
                  <thead>
                    <tr>
                      <th>Use</th>
                      <th>Column</th>
                      <th>Assignment name</th>
                      <th>Points</th>
                      {cls.gradingMode === 'weighted' && <th>Category</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {cols.map((c) => {
                      const match = existingByTitle.get(normTitle(c.title))
                      return (
                        <tr key={c.index} className={c.include ? '' : 'dim'}>
                          <td>
                            <input
                              type="checkbox"
                              checked={c.include}
                              aria-label={`Use ${c.header}`}
                              onChange={(e) => update(c.index, { include: e.target.checked })}
                            />
                          </td>
                          <td>{c.header}</td>
                          <td>
                            <input
                              value={c.title}
                              disabled={!c.include}
                              aria-label={`Name for ${c.header}`}
                              onChange={(e) => update(c.index, { title: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className="narrow"
                              value={c.points}
                              disabled={!c.include}
                              inputMode="decimal"
                              placeholder={match ? formatPoints(match.pointsPossible) : ''}
                              aria-label={`Points for ${c.header}`}
                              onChange={(e) => update(c.index, { points: e.target.value })}
                            />
                          </td>
                          {cls.gradingMode === 'weighted' && (
                            <td>
                              <select
                                value={c.categoryId ?? ''}
                                disabled={!c.include || !!match}
                                aria-label={`Category for ${c.header}`}
                                onChange={(e) =>
                                  update(c.index, {
                                    categoryId: e.target.value ? Number(e.target.value) : null
                                  })
                                }
                              >
                                <option value="">none</option>
                                {categories.map((cat) => (
                                  <option key={cat.id} value={cat.id}>
                                    {cat.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          <td className="hint">
                            {c.include ? (match ? 'updates existing' : 'new assignment') : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {problem && <p className="hint warn">{problem}</p>}
              </fieldset>
            </>
          )}
        </div>
      )}

      {step === 'preview' && plan && (
        <div>
          <p className="summary" role="status">
            <strong>{plan.counts.scoresToWrite}</strong> scores to save ·{' '}
            <strong>{plan.counts.unchanged}</strong> already match ·{' '}
            <strong>{plan.counts.newAssignments}</strong> new assignments ·{' '}
            <strong>{plan.counts.matchedStudents}</strong> students matched
            {plan.counts.unmatchedStudents > 0 && (
              <>
                {' '}
                · <strong>{plan.counts.unmatchedStudents}</strong> rows not matched
              </>
            )}
            {plan.counts.invalidCells > 0 && (
              <>
                {' '}
                · <strong>{plan.counts.invalidCells}</strong> cells skipped
              </>
            )}
          </p>
          {plan.problems.length > 0 && (
            <div className="error-banner" role="alert">
              <div>
                {plan.problems.slice(0, 8).map((p, i) => (
                  <div key={i}>
                    Row {p.rowNumber}: {p.message}
                  </div>
                ))}
                {plan.problems.length > 8 && <div>…and {plan.problems.length - 8} more</div>}
              </div>
            </div>
          )}
          <div className="table-scroll">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Student</th>
                  <th>Assignment</th>
                  <th>Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.changes.slice(0, 300).map((c, i) => (
                  <tr key={i} className={c.unchanged ? 'dim' : ''}>
                    <td>{c.rowNumber}</td>
                    <td>{label(c.rowNumber)}</td>
                    <td>{plan.assignments[c.column].title}</td>
                    <td>
                      {c.status === 'missing'
                        ? 'Missing'
                        : c.status === 'excused'
                          ? 'Excused'
                          : formatPoints(c.points)}
                    </td>
                    <td className="hint">
                      {c.unchanged
                        ? 'no change'
                        : c.assignmentId === null
                          ? 'new assignment'
                          : 'update'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.changes.length > 300 && (
            <p className="hint">Showing the first 300 of {plan.changes.length}.</p>
          )}
        </div>
      )}
    </Modal>
  )
}
