import { useState } from 'react'
import type { LinkRecordType } from '@shared/models'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel, studentName } from '@renderer/lib/labels'

export interface RecordRef {
  recordType: LinkRecordType
  recordId: number
}

/** Chooses a class or a student. */
export default function RecordPicker({
  value,
  onChange
}: {
  value: RecordRef | null
  onChange: (ref: RecordRef | null) => void
}): React.JSX.Element {
  const [type, setType] = useState<'class' | 'student'>(
    value?.recordType === 'student' ? 'student' : 'class'
  )
  const [search, setSearch] = useState('')
  const classes = useApiQuery(() => window.api.classes.list(), [], ['classes.changed'])
  const students = useApiQuery(
    () => window.api.students.list({ search }),
    [search],
    ['students.changed']
  )

  return (
    <div className="form">
      <div className="row">
        <label className="check">
          <input
            type="radio"
            checked={type === 'class'}
            onChange={() => {
              setType('class')
              onChange(null)
            }}
          />
          A class
        </label>
        <label className="check">
          <input
            type="radio"
            checked={type === 'student'}
            onChange={() => {
              setType('student')
              onChange(null)
            }}
          />
          A student
        </label>
      </div>
      {type === 'class' ? (
        <select
          aria-label="Class"
          value={value?.recordType === 'class' ? value.recordId : ''}
          onChange={(e) =>
            onChange(
              e.target.value ? { recordType: 'class', recordId: Number(e.target.value) } : null
            )
          }
        >
          <option value="">Choose a class…</option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)} ({c.termName})
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            className="search"
            placeholder="Search students"
            aria-label="Search students"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="pick-list">
            {(students.data ?? []).map((s) => (
              <li key={s.id}>
                <label className="check">
                  <input
                    type="radio"
                    name="student"
                    checked={value?.recordType === 'student' && value.recordId === s.id}
                    onChange={() => onChange({ recordType: 'student', recordId: s.id })}
                  />
                  {studentName(s)}
                </label>
              </li>
            ))}
            {(students.data ?? []).length === 0 && <li className="hint">No students found.</li>}
          </ul>
        </>
      )}
    </div>
  )
}
