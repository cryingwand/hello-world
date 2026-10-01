import { useState } from 'react'
import type { Student } from '@shared/models'
import Modal from '@renderer/components/Modal'
import { useApiQuery } from '@renderer/data/hooks'
import { studentName } from '@renderer/lib/labels'

/** Makes a student an advisee: pick an existing one, or create someone new. */
export default function AddAdviseeDialog({
  onClose,
  onAdded
}: {
  onClose: () => void
  onAdded: (student: Student) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [search, setSearch] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [error, setError] = useState<string | null>(null)
  const students = useApiQuery(
    () => window.api.students.list({ search: search || undefined }),
    [search],
    ['students.changed']
  )
  const candidates = (students.data ?? []).filter((s) => !s.tags.includes('advisee'))

  const finish = async (work: () => Promise<Student>): Promise<void> => {
    try {
      onAdded(await work())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const tag = (s: Student): Promise<Student> =>
    window.api.students.update(s.id, { tags: [...s.tags, 'advisee'] })

  return (
    <Modal
      title="Add advisee"
      error={error}
      onClose={onClose}
      footer={
        mode === 'new' ? (
          <>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              form="new-advisee-form"
              className="btn btn-primary"
              disabled={!first.trim() && !last.trim()}
            >
              Add
            </button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </>
        )
      }
    >
      <div className="tabs" role="tablist">
        {(['existing', 'new'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'tab tab-on' : 'tab'}
            onClick={() => setMode(m)}
          >
            {m === 'existing' ? 'Existing student' : 'New student'}
          </button>
        ))}
      </div>
      {mode === 'existing' ? (
        <>
          <input
            className="search"
            placeholder="Search students"
            aria-label="Search students"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {candidates.length === 0 ? (
            <p className="hint">No other students match.</p>
          ) : (
            <ul className="adv-list">
              {candidates.slice(0, 50).map((s) => (
                <li key={s.id} className="adv-item">
                  <span className="adv-grow">{studentName(s)}</span>
                  <button className="btn" onClick={() => void finish(() => tag(s))}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <form
          id="new-advisee-form"
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            void finish(() =>
              window.api.students.create({ firstName: first, lastName: last, tags: ['advisee'] })
            )
          }}
        >
          <div className="form-row">
            <label>
              First name
              <input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
            </label>
            <label>
              Last name
              <input value={last} onChange={(e) => setLast(e.target.value)} />
            </label>
          </div>
        </form>
      )}
    </Modal>
  )
}
