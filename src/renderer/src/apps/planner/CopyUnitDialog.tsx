import { useState } from 'react'
import type { UnitDetail } from '@shared/models'
import type { CopyDates } from '@shared/lesson'
import Modal from '@renderer/components/Modal'

type Choice = 'clear' | 'keep' | 'shift'

/**
 * Copies a unit for next term or next year. Dates are cleared by default because last year's dates
 * are wrong; "move" shifts every lesson by the same number of weeks, which keeps the weekdays.
 */
export default function CopyUnitDialog({
  unit,
  onClose,
  onCopied
}: {
  unit: UnitDetail
  onClose: () => void
  onCopied: (id: number) => void
}): React.JSX.Element {
  const [title, setTitle] = useState(`${unit.title} (copy)`.slice(0, 200))
  const [choice, setChoice] = useState<Choice>('clear')
  const [weeks, setWeeks] = useState('52')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dated = unit.lessons.filter((l) => l.date).length
  const w = Number(weeks)
  const shiftOk = Number.isInteger(w) && Math.abs(w) <= 520 && weeks.trim() !== ''

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (choice === 'shift' && !shiftOk) {
      setError('Enter a whole number of weeks, such as 52 for a year later.')
      return
    }
    const dates: CopyDates = choice === 'shift' ? { mode: 'shift', days: w * 7 } : { mode: choice }
    setSaving(true)
    try {
      onCopied((await window.api.units.duplicate(unit.id, { title, dates })).id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Copy unit"
      error={error}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="copy-unit-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Copying…' : 'Copy'}
          </button>
        </>
      }
    >
      <form id="copy-unit-form" className="form" onSubmit={save}>
        <p className="hint">
          Copies the unit’s details and its {unit.lessons.length}{' '}
          {unit.lessons.length === 1 ? 'lesson' : 'lessons'}, with the same quizzes linked and the
          same files attached. The original is not changed.
        </p>
        <label>
          Title of the copy
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>
        <fieldset>
          <legend>Lesson dates{dated > 0 ? ` (${dated} dated)` : ''}</legend>
          <label className="check">
            <input
              type="radio"
              name="dates"
              checked={choice === 'clear'}
              onChange={() => setChoice('clear')}
            />
            Leave them blank, to fill in later
          </label>
          <label className="check">
            <input
              type="radio"
              name="dates"
              checked={choice === 'shift'}
              onChange={() => setChoice('shift')}
            />
            Move every date by
            <input
              className="narrow"
              value={weeks}
              inputMode="numeric"
              aria-label="Weeks to move the dates"
              onFocus={() => setChoice('shift')}
              onChange={(e) => setWeeks(e.target.value)}
            />
            weeks (52 is a year later, the same weekdays)
          </label>
          <label className="check">
            <input
              type="radio"
              name="dates"
              checked={choice === 'keep'}
              onChange={() => setChoice('keep')}
            />
            Keep the same dates
          </label>
        </fieldset>
      </form>
    </Modal>
  )
}
