import { useMemo, useState } from 'react'
import type { ClassSummary, GradingMode, Term } from '@shared/models'
import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  emptyMapping,
  guessMapping,
  type ImportAction,
  type ImportMapping,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type ImportTarget,
  type TableFile
} from '@shared/roster'
import Modal from '@renderer/components/Modal'
import Sensitive from '@renderer/components/Sensitive'
import { classLabel, columnLetter } from '@renderer/lib/labels'

const ACTION_LABEL: Record<ImportAction, string> = {
  create: 'New student',
  'enroll-existing': 'Existing student, add to class',
  'already-enrolled': 'Already in this class',
  'duplicate-in-file': 'Repeated in file (skipped)',
  invalid: 'Problem (skipped)'
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export default function ImportWizard({
  classes,
  terms,
  defaultClassId,
  onClose,
  onDone
}: {
  classes: ClassSummary[]
  terms: Term[]
  defaultClassId: number | null
  onClose: () => void
  onDone: (result: ImportResult) => void
}): React.JSX.Element {
  const [file, setFile] = useState<TableFile | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping())
  const [targetKind, setTargetKind] = useState<'existing' | 'new'>(
    defaultClassId ? 'existing' : 'new'
  )
  const [classId, setClassId] = useState<number | ''>(defaultClassId ?? classes[0]?.id ?? '')
  const [termId, setTermId] = useState<number | ''>(
    terms.find((t) => t.isCurrent)?.id ?? terms[0]?.id ?? ''
  )
  const [course, setCourse] = useState('')
  const [section, setSection] = useState('')
  const [period, setPeriod] = useState('')
  const [mode, setMode] = useState<GradingMode>('points')
  const [step, setStep] = useState<'map' | 'preview'>('map')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const width = useMemo(
    () => (file ? Math.max(0, ...file.rows.slice(0, 50).map((r) => r.length)) : 0),
    [file]
  )
  const columns = useMemo(
    () =>
      Array.from({ length: width }, (_, i) => {
        const head = hasHeader ? file?.rows[0]?.[i] : ''
        return {
          index: i,
          label: head ? `${columnLetter(i)}: ${head}` : `Column ${columnLetter(i)}`
        }
      }),
    [file, hasHeader, width]
  )

  const load = (f: TableFile, header: boolean): void => {
    setFile(f)
    setMapping(header ? guessMapping(f.rows[0] ?? []) : emptyMapping())
    setPreview(null)
    setStep('map')
  }

  const choose = async (): Promise<void> => {
    setError(null)
    try {
      const f = await window.api.roster.chooseFile()
      if (f) load(f, hasHeader)
    } catch (e) {
      setError(msg(e))
    }
  }
  const changeSheet = async (sheet: string): Promise<void> => {
    if (!file) return
    try {
      load(await window.api.roster.readSheet(file.token, sheet), hasHeader)
    } catch (e) {
      setError(msg(e))
    }
  }
  const toggleHeader = (on: boolean): void => {
    setHasHeader(on)
    if (file) setMapping(on ? guessMapping(file.rows[0] ?? []) : emptyMapping())
  }

  const target = (): ImportTarget | null => {
    if (targetKind === 'existing') return classId === '' ? null : { classId }
    if (termId === '') return null
    return { newClass: { termId, course, section, period, gradingMode: mode } }
  }
  const request = (): ImportRequest | null => {
    const t = target()
    if (!file || !t) return null
    return { token: file.token, sheet: file.sheet, hasHeader, mapping, target: t }
  }

  const hasNameColumn =
    mapping.firstName !== null || mapping.lastName !== null || mapping.fullName !== null
  const targetReady =
    targetKind === 'existing' ? classId !== '' : termId !== '' && course.trim() !== ''

  const runPreview = async (): Promise<void> => {
    const req = request()
    if (!req) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await window.api.roster.preview(req))
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
      onDone(await window.api.roster.commit(req))
    } catch (e) {
      setError(msg(e))
      setBusy(false)
    }
  }

  const importable = preview ? preview.counts.create + preview.counts.enrollExisting : 0

  return (
    <Modal
      title="Import roster"
      wide
      sensitive
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
              disabled={!file || !hasNameColumn || !targetReady || busy}
              onClick={runPreview}
            >
              Preview
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={importable === 0 || busy}
              onClick={commit}
            >
              {busy ? 'Importing…' : `Import ${importable} student${importable === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      }
    >
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {step === 'map' && (
        <div className="form">
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
              <label className="check">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => toggleHeader(e.target.checked)}
                />
                First row is a header
              </label>

              <fieldset>
                <legend>Which column holds what?</legend>
                <div className="map-grid">
                  {IMPORT_FIELDS.map((f) => (
                    <label key={f}>
                      {FIELD_LABELS[f]}
                      <select
                        aria-label={FIELD_LABELS[f]}
                        value={mapping[f] ?? ''}
                        onChange={(e) =>
                          setMapping({
                            ...mapping,
                            [f]: e.target.value === '' ? null : Number(e.target.value)
                          })
                        }
                      >
                        <option value="">(not in this file)</option>
                        {columns.map((c) => (
                          <option key={c.index} value={c.index}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {!hasNameColumn && (
                  <p className="hint">
                    Choose the column with student names (First and Last, or Full name).
                  </p>
                )}
              </fieldset>

              <div className="sample">
                <div className="hint">First rows of your file</div>
                <table className="grid-table compact">
                  <tbody>
                    {file.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c.index}>
                            <Sensitive>{r[c.index] ?? ''}</Sensitive>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <fieldset>
                <legend>Add these students to</legend>
                <label className="check">
                  <input
                    type="radio"
                    checked={targetKind === 'existing'}
                    onChange={() => setTargetKind('existing')}
                    disabled={classes.length === 0}
                  />
                  An existing class
                  <select
                    value={classId}
                    disabled={targetKind !== 'existing'}
                    onChange={(e) => setClassId(Number(e.target.value))}
                    aria-label="Existing class"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {classLabel(c)} ({c.termName})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    type="radio"
                    checked={targetKind === 'new'}
                    onChange={() => setTargetKind('new')}
                  />
                  A new class
                </label>
                {targetKind === 'new' && (
                  <div className="form-row nested">
                    <label>
                      Term
                      <select
                        value={termId}
                        onChange={(e) => setTermId(Number(e.target.value))}
                        aria-label="Term for new class"
                      >
                        {terms.length === 0 && <option value="">Create a term first</option>}
                        {terms.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Course
                      <input
                        value={course}
                        onChange={(e) => setCourse(e.target.value)}
                        placeholder="US History"
                        aria-label="Course for new class"
                      />
                    </label>
                    <label>
                      Section
                      <input value={section} onChange={(e) => setSection(e.target.value)} />
                    </label>
                    <label>
                      Period
                      <input value={period} onChange={(e) => setPeriod(e.target.value)} />
                    </label>
                    <label>
                      Grading
                      <select value={mode} onChange={(e) => setMode(e.target.value as GradingMode)}>
                        <option value="points">Total points</option>
                        <option value="weighted">Weighted categories</option>
                      </select>
                    </label>
                  </div>
                )}
              </fieldset>
            </>
          )}
        </div>
      )}

      {step === 'preview' && preview && (
        <div>
          <p className="summary" role="status">
            <strong>{preview.counts.create}</strong> new ·{' '}
            <strong>{preview.counts.enrollExisting}</strong> existing students to add ·{' '}
            <strong>{preview.counts.alreadyEnrolled}</strong> already in the class ·{' '}
            <strong>{preview.counts.duplicate + preview.counts.invalid}</strong> skipped
          </p>
          <div className="table-scroll">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>What will happen</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 300).map((r) => (
                  <tr key={r.rowNumber} className={`plan-${r.action}`}>
                    <td>{r.rowNumber}</td>
                    <td>
                      <Sensitive>
                        {[r.student?.lastName, r.student?.firstName].filter(Boolean).join(', ')}
                      </Sensitive>
                    </td>
                    <td>
                      <Sensitive>{r.student?.email}</Sensitive>
                    </td>
                    <td>
                      {ACTION_LABEL[r.action]}
                      {r.action === 'invalid' && r.note ? ` — ${r.note}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 300 && (
            <p className="hint">Showing the first 300 of {preview.rows.length} rows.</p>
          )}
        </div>
      )}
    </Modal>
  )
}
