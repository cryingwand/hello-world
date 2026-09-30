import { useState } from 'react'
import Modal from '@renderer/components/Modal'
import Sensitive from '@renderer/components/Sensitive'
import { useApiQuery } from '@renderer/data/hooks'
import { studentName } from '@renderer/lib/labels'

/** Enroll students who already exist in another class or on their own. */
export default function AddExistingDialog({
  classId,
  onClose
}: {
  classId: number
  onClose: () => void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const all = useApiQuery(
    () => window.api.students.list({ search }),
    [search],
    ['students.changed']
  )
  const roster = useApiQuery(
    () => window.api.classes.roster(classId),
    [classId],
    ['enrollments.changed']
  )
  const enrolled = new Set((roster.data ?? []).map((s) => s.id))
  const candidates = (all.data ?? []).filter((s) => !enrolled.has(s.id))

  return (
    <Modal
      error={error}
      title="Add existing students"
      sensitive
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <input
        className="search"
        placeholder="Search by name or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      <ul className="pick-list">
        {candidates.map((s) => (
          <li key={s.id}>
            <span>
              <Sensitive>{studentName(s)}</Sensitive>
            </span>
            <button
              className="btn"
              onClick={() =>
                window.api.classes
                  .enroll(classId, s.id)
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
              }
            >
              Add
            </button>
          </li>
        ))}
        {candidates.length === 0 && (
          <li className="hint">No matching students outside this class.</li>
        )}
      </ul>
    </Modal>
  )
}
