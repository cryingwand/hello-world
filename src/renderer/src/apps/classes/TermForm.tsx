import { useState } from 'react'
import type { Term } from '@shared/models'
import Modal from '@renderer/components/Modal'

export default function TermForm({
  term,
  onClose,
  onSaved
}: {
  term?: Term
  onClose: () => void
  onSaved: (t: Term) => void
}): React.JSX.Element {
  const [name, setName] = useState(term?.name ?? '')
  const [start, setStart] = useState(term?.startDate ?? '')
  const [end, setEnd] = useState(term?.endDate ?? '')
  const [current, setCurrent] = useState(term?.isCurrent ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    try {
      const input = { name, startDate: start || null, endDate: end || null, isCurrent: current }
      const saved = term
        ? await window.api.terms.update(term.id, input)
        : await window.api.terms.create(input)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!term || !window.confirm(`Delete ${term.name}? This only works if it has no classes.`))
      return
    try {
      await window.api.terms.delete(term.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      error={error}
      title={term ? 'Edit term' : 'New term'}
      onClose={onClose}
      footer={
        <>
          {term && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="term-form" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <form id="term-form" className="form" onSubmit={save}>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fall 2026"
            autoFocus
            required
          />
        </label>
        <div className="form-row">
          <label>
            Starts
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Ends
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
          This is the current term
        </label>
      </form>
    </Modal>
  )
}
