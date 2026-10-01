import { useState } from 'react'
import type { ExternalProgress } from '@shared/models'
import Modal from '@renderer/components/Modal'

export default function ProgressForm({
  studentId,
  entry,
  onClose
}: {
  studentId: number
  entry?: ExternalProgress
  onClose: () => void
}): React.JSX.Element {
  const [course, setCourse] = useState(entry?.course ?? '')
  const [term, setTerm] = useState(entry?.term ?? '')
  const [grade, setGrade] = useState(entry?.grade ?? '')
  const [source, setSource] = useState(entry?.source ?? '')
  const [recorded, setRecorded] = useState(entry?.recordedOn ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    try {
      const input = { course, term, grade, source, recordedOn: recorded || null }
      if (entry) await window.api.advising.updateProgress(entry.id, input)
      else await window.api.advising.createProgress({ studentId, ...input })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }
  const remove = async (): Promise<void> => {
    if (!entry || !window.confirm(`Delete the ${entry.course} entry?`)) return
    try {
      await window.api.advising.deleteProgress(entry.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      title={entry ? 'Edit grade' : 'New grade'}
      error={error}
      onClose={onClose}
      footer={
        <>
          {entry && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="progress-form" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <form id="progress-form" className="form" onSubmit={save}>
        <label>
          Course
          <input value={course} onChange={(e) => setCourse(e.target.value)} autoFocus required />
        </label>
        <div className="form-row">
          <label>
            Term
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Fall 2026" />
          </label>
          <label>
            Grade
            <input
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="B+ or 87"
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Source
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Where the grade comes from"
            />
          </label>
          <label>
            As of
            <input type="date" value={recorded} onChange={(e) => setRecorded(e.target.value)} />
          </label>
        </div>
      </form>
    </Modal>
  )
}
