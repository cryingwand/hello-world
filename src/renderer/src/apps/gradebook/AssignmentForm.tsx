import { useState } from 'react'
import type { Assignment, GradeCategory } from '@shared/models'
import Modal from '@renderer/components/Modal'

export default function AssignmentForm({
  classId,
  assignment,
  categories,
  onClose,
  onSaved
}: {
  classId: number
  assignment?: Assignment
  categories: GradeCategory[]
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(assignment?.title ?? '')
  const [points, setPoints] = useState(assignment ? String(assignment.pointsPossible) : '')
  const [categoryId, setCategoryId] = useState<number | ''>(assignment?.categoryId ?? '')
  const [due, setDue] = useState(assignment?.dueDate ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const pts = Number(points)
    if (points.trim() === '' || !Number.isFinite(pts) || pts < 0)
      return setError('Points possible must be a number, 0 or more')
    setSaving(true)
    try {
      const input = {
        title,
        pointsPossible: pts,
        categoryId: categoryId === '' ? null : categoryId,
        dueDate: due || null
      }
      if (assignment) await window.api.grading.updateAssignment(assignment.id, input)
      else await window.api.grading.createAssignment({ classId, ...input })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }
  const remove = async (): Promise<void> => {
    if (
      !assignment ||
      !window.confirm(
        `Delete “${assignment.title}” and every score entered for it? A backup is taken first, so this can be undone from Settings in the Vault.`
      )
    )
      return
    try {
      await window.api.grading.deleteAssignment(assignment.id)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      title={assignment ? 'Edit assignment' : 'New assignment'}
      error={error}
      onClose={onClose}
      footer={
        <>
          {assignment && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="assignment-form"
            className="btn btn-primary"
            disabled={saving}
          >
            Save
          </button>
        </>
      }
    >
      <form id="assignment-form" className="form" onSubmit={save}>
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Unit 3 Quiz"
            autoFocus
            required
          />
        </label>
        <div className="form-row">
          <label>
            Points possible
            <input
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              inputMode="decimal"
              placeholder="20"
              required
            />
          </label>
          <label>
            Due date
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <label>
          Category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  )
}
