import { useMemo, useState } from 'react'
import { formatDate } from '@shared/advising'
import {
  detectProgressColumns,
  emptyProgressMapping,
  type ProgressAction,
  type ProgressImportMapping,
  type ProgressImportPlan,
  type ProgressImportRequest,
  type ProgressImportResult
} from '@shared/progressImport'
import type { TableFile } from '@shared/roster'
import Modal from '@renderer/components/Modal'
import { columnLetter } from '@renderer/lib/labels'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const FIELDS: { key: keyof ProgressImportMapping; label: string; group: 'who' | 'what' }[] = [
  { key: 'lastName', label: 'Last name', group: 'who' },
  { key: 'firstName', label: 'First name', group: 'who' },
  { key: 'fullName', label: 'Full name (one column)', group: 'who' },
  { key: 'email', label: 'Email', group: 'who' },
  { key: 'course', label: 'Course', group: 'what' },
  { key: 'grade', label: 'Grade', group: 'what' },
  { key: 'term', label: 'Term', group: 'what' },
  { key: 'source', label: 'Source', group: 'what' },
  { key: 'recordedOn', label: 'As of (date)', group: 'what' }
]

const ACTION_LABEL: Record<ProgressAction, string> = {
  create: 'new',
  update: 'update',
  unchanged: 'no change',
  unmatched: 'not matched',
  'duplicate-in-file': 'repeat in file',
  invalid: 'skipped'
}

/**
 * Brings in grades earned elsewhere for every advisee at once: pick a file, say which column is
 * which, check the preview, import. Nothing is written until the last step.
 */
export default function ProgressImportWizard({
  onClose,
  onDone
}: {
  onClose: () => void
  onDone: (r: ProgressImportResult) => void
}): React.JSX.Element {
  const [file, setFile] = useState<TableFile | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<ProgressImportMapping>(emptyProgressMapping())
  const [term, setTerm] = useState('')
  const [source, setSource] = useState('')
  const [asOf, setAsOf] = useState('')
  const [step, setStep] = useState<'map' | 'preview'>('map')
  const [plan, setPlan] = useState<ProgressImportPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const width = useMemo(
    () => (file ? Math.max(0, ...file.rows.slice(0, 50).map((r) => r.length)) : 0),
    [file]
  )

  const analyse = (f: TableFile, header: boolean): void => {
    setMapping(header ? detectProgressColumns(f.rows[0] ?? []) : emptyProgressMapping())
    setPlan(null)
    setStep('map')
  }
  const load = async (pick: () => Promise<TableFile | null>): Promise<void> => {
    setError(null)
    try {
      const f = await pick()
      if (f) {
        setFile(f)
        analyse(f, hasHeader)
      }
    } catch (e) {
      setError(msg(e))
    }
  }

  const hasStudentColumn = [
    mapping.firstName,
    mapping.lastName,
    mapping.fullName,
    mapping.email
  ].some((i) => i !== null)
  const problem = !hasStudentColumn
    ? 'Choose the column that identifies each student.'
    : mapping.course === null
      ? 'Choose the column that holds the course.'
      : mapping.grade === null
        ? 'Choose the column that holds the grade.'
        : null

  const request = (): ProgressImportRequest | null =>
    !file || problem
      ? null
      : {
          token: file.token,
          sheet: file.sheet,
          hasHeader,
          mapping,
          defaults: { term: term.trim(), source: source.trim(), recordedOn: asOf || null }
        }

  const run = async (kind: 'preview' | 'commit'): Promise<void> => {
    const req = request()
    if (!req) return
    setBusy(true)
    setError(null)
    try {
      if (kind === 'preview') {
        setPlan(await window.api.advising.previewProgressImport(req))
        setStep('preview')
      } else {
        onDone(await window.api.advising.commitProgressImport(req))
        return
      }
    } catch (e) {
      setError(msg(e))
    }
    setBusy(false)
  }

  const toWrite = plan ? plan.counts.create + plan.counts.update : 0
  const optionsFor = (header: TableFile): React.JSX.Element[] =>
    Array.from({ length: width }, (_, i) => (
      <option key={i} value={i}>
        {columnLetter(i)}: {hasHeader ? (header.rows[0]?.[i] ?? '') : `Column ${columnLetter(i)}`}
      </option>
    ))
  const picker = (f: (typeof FIELDS)[number], header: TableFile): React.JSX.Element => (
    <label key={f.key}>
      {f.label}
      <select
        aria-label={f.label}
        value={mapping[f.key] ?? ''}
        onChange={(e) =>
          setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) })
        }
      >
        <option value="">(not in this file)</option>
        {optionsFor(header)}
      </select>
    </label>
  )

  return (
    <Modal
      title="Import grades from elsewhere"
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
              onClick={() => run('preview')}
              disabled={!file || !!problem || busy}
              title={problem ?? undefined}
            >
              Preview
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => run('commit')}
              disabled={toWrite === 0 || busy}
            >
              {busy ? 'Importing…' : `Import ${toWrite} grade${toWrite === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      }
    >
      {step === 'map' && (
        <div className="form">
          <p className="hint">
            One row is one grade for one advisee. Students are matched to your advisees by email,
            then by name. A grade for the same student, course, term and source is updated rather
            than added twice, so importing the same file again is safe.
          </p>
          <div className="row">
            <button className="btn" onClick={() => load(() => window.api.roster.chooseFile())}>
              {file ? 'Choose a different file…' : 'Choose spreadsheet or CSV…'}
            </button>
            {file && <strong>{file.fileName}</strong>}
            {file && file.sheetNames.length > 1 && (
              <label className="inline">
                Sheet
                <select
                  value={file.sheet ?? ''}
                  onChange={(e) =>
                    load(() => window.api.roster.readSheet(file.token, e.target.value))
                  }
                >
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
                  onChange={(e) => {
                    setHasHeader(e.target.checked)
                    analyse(file, e.target.checked)
                  }}
                />
                First row is a header
              </label>

              <fieldset>
                <legend>Who is in each row?</legend>
                <div className="map-grid">
                  {FIELDS.filter((f) => f.group === 'who').map((f) => picker(f, file))}
                </div>
              </fieldset>
              <fieldset>
                <legend>What is the grade?</legend>
                <div className="map-grid">
                  {FIELDS.filter((f) => f.group === 'what').map((f) => picker(f, file))}
                </div>
              </fieldset>
              <fieldset>
                <legend>When the file leaves these out</legend>
                <p className="hint">
                  Used for every row whose column is missing or blank, for example one source for a
                  whole file.
                </p>
                <div className="form-row">
                  <label>
                    Term
                    <input
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      placeholder="Fall 2026"
                    />
                  </label>
                  <label>
                    Source
                    <input
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder="Where the grades come from"
                    />
                  </label>
                  <label>
                    As of
                    <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                  </label>
                </div>
              </fieldset>
              {problem && <p className="hint warn">{problem}</p>}
            </>
          )}
        </div>
      )}

      {step === 'preview' && plan && (
        <div>
          <p className="summary" role="status">
            <strong>{plan.counts.create}</strong> new · <strong>{plan.counts.update}</strong>{' '}
            updated · <strong>{plan.counts.unchanged}</strong> already match
            {plan.counts.unmatched > 0 && (
              <>
                {' '}
                · <strong>{plan.counts.unmatched}</strong> not matched to an advisee
              </>
            )}
            {plan.counts.duplicate + plan.counts.invalid > 0 && (
              <>
                {' '}
                · <strong>{plan.counts.duplicate + plan.counts.invalid}</strong> skipped
              </>
            )}
          </p>
          <div className="table-scroll">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Student</th>
                  <th>Course</th>
                  <th>Term</th>
                  <th>Grade</th>
                  <th>As of</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice(0, 300).map((r) => (
                  <tr
                    key={r.rowNumber}
                    className={
                      r.action === 'unchanged' ? 'dim' : r.entry && r.studentId ? '' : 'dim warn'
                    }
                  >
                    <td>{r.rowNumber}</td>
                    <td>{r.label}</td>
                    <td>{r.entry?.course}</td>
                    <td>{r.entry?.term}</td>
                    <td>
                      {r.action === 'update' && r.previousGrade
                        ? `${r.previousGrade} → ${r.entry?.grade}`
                        : r.entry?.grade}
                    </td>
                    <td>{formatDate(r.entry?.recordedOn ?? null)}</td>
                    <td className="hint">
                      {ACTION_LABEL[r.action]}
                      {r.note && ` · ${r.note}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.rows.length > 300 && (
            <p className="hint">Showing the first 300 of {plan.rows.length} rows.</p>
          )}
        </div>
      )}
    </Modal>
  )
}
