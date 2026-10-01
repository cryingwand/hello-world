import { useState } from 'react'
import type { AdvisingGoal, GoalStatus } from '@shared/models'
import Modal from '@renderer/components/Modal'

export default function GoalForm({
  studentId,
  goal,
  onClose
}: {
  studentId: number
  goal?: AdvisingGoal
  onClose: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [details, setDetails] = useState(goal?.details ?? '')
  const [target, setTarget] = useState(goal?.targetDate ?? '')
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    try {
      const input = { title, details, targetDate: target || null, status }
      if (goal) await window.api.advising.updateGoal(goal.id, input)
      else await window.api.advising.createGoal({ studentId, ...input })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }
  const remove = async (): Promise<void> => {
    if (!goal || !window.confirm(`Delete the goal “${goal.title}”? Its follow-ups are kept.`))
      return
    try {
      await window.api.advising.deleteGoal(goal.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      title={goal ? 'Edit goal' : 'New goal'}
      error={error}
      onClose={onClose}
      footer={
        <>
          {goal && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="goal-form" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <form id="goal-form" className="form" onSubmit={save}>
        <label>
          Goal
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>
        <label>
          Details
          <textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        <div className="form-row">
          <label>
            Target date
            <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>
              <option value="active">Active</option>
              <option value="achieved">Achieved</option>
              <option value="dropped">Dropped</option>
            </select>
          </label>
        </div>
      </form>
    </Modal>
  )
}
