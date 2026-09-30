import { useState } from 'react'
import type { ClassRecord, GradingMode, Term } from '@shared/models'
import Modal from '@renderer/components/Modal'

export default function ClassForm({
  cls,
  terms,
  defaultTermId,
  onClose,
  onSaved,
  onDeleted
}: {
  cls?: ClassRecord
  terms: Term[]
  defaultTermId?: number
  onClose: () => void
  onSaved: (c: ClassRecord) => void
  onDeleted?: () => void
}): React.JSX.Element {
  const [termId, setTermId] = useState<number | ''>(
    cls?.termId ?? defaultTermId ?? terms.find((t) => t.isCurrent)?.id ?? terms[0]?.id ?? ''
  )
  const [course, setCourse] = useState(cls?.course ?? '')
  const [section, setSection] = useState(cls?.section ?? '')
  const [period, setPeriod] = useState(cls?.period ?? '')
  const [mode, setMode] = useState<GradingMode>(cls?.gradingMode ?? 'points')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (termId === '') return setError('Create a term first')
    setSaving(true)
    try {
      const input = { termId, course, section, period, gradingMode: mode }
      const saved = cls
        ? await window.api.classes.update(cls.id, input)
        : await window.api.classes.create(input)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!cls) return
    const ok = window.confirm(
      `Delete ${cls.course}? This removes its roster links, assignments and scores. Students stay in your student list.`
    )
    if (!ok) return
    try {
      await window.api.classes.delete(cls.id)
      onDeleted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      error={error}
      title={cls ? 'Edit class' : 'New class'}
      onClose={onClose}
      footer={
        <>
          {cls && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete class
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="class-form" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <form id="class-form" className="form" onSubmit={save}>
        <label>
          Term
          <select value={termId} onChange={(e) => setTermId(Number(e.target.value))} required>
            {terms.length === 0 && <option value="">No terms yet</option>}
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
            autoFocus
            required
          />
        </label>
        <div className="form-row">
          <label>
            Section
            <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="B" />
          </label>
          <label>
            Period
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="3" />
          </label>
        </div>
        <fieldset>
          <legend>How is this class graded?</legend>
          <label className="check">
            <input
              type="radio"
              name="mode"
              checked={mode === 'points'}
              onChange={() => setMode('points')}
            />
            <span>
              Total points <span className="hint">(sum of points earned over points possible)</span>
            </span>
          </label>
          <label className="check">
            <input
              type="radio"
              name="mode"
              checked={mode === 'weighted'}
              onChange={() => setMode('weighted')}
            />
            <span>
              Weighted categories{' '}
              <span className="hint">(for example Tests 60%, Homework 40%)</span>
            </span>
          </label>
        </fieldset>
      </form>
    </Modal>
  )
}
