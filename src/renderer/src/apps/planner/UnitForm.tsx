import { useState } from 'react'
import Modal from '@renderer/components/Modal'
import { useApiQuery } from '@renderer/data/hooks'

export default function UnitForm({
  defaultCourse,
  defaultTermId = null,
  onClose,
  onCreated
}: {
  /** The course of the unit last looked at, since units are planned one course at a time. */
  defaultCourse: string
  /** The semester being planned, when the unit is added from its roadmap. */
  defaultTermId?: number | null
  onClose: () => void
  onCreated: (id: number) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [course, setCourse] = useState(defaultCourse)
  const [termId, setTermId] = useState<number | null>(defaultTermId)
  const terms = useApiQuery(() => window.api.terms.list(), [], ['terms.changed'])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    try {
      const made = await window.api.units.create({ title, course, termId })
      onCreated(made.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title="New unit"
      error={error}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="unit-form" className="btn btn-primary" disabled={saving}>
            Create
          </button>
        </>
      }
    >
      <form id="unit-form" className="form" onSubmit={save}>
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Foundations of ethics"
            autoFocus
            required
          />
        </label>
        <label>
          Course
          <input
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            placeholder="PHIL 101"
          />
        </label>
        <label>
          Semester
          <select
            value={termId ?? ''}
            onChange={(e) => setTermId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">None</option>
            {(terms.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  )
}
