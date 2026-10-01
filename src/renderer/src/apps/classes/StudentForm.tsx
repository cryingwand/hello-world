import { useState } from 'react'
import type { ClassSummary, Student } from '@shared/models'
import Modal from '@renderer/components/Modal'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'

export default function StudentForm({
  student,
  enrollInClassId,
  onOpenGradebook,
  onOpenAdvising,
  onClose,
  onSaved
}: {
  student?: Student
  /** For a new student: also enroll them here. */
  enrollInClassId?: number | null
  /** Opens this student in the Gradebook (the `open-student` intent). */
  onOpenGradebook?: (studentId: number) => void
  /** Opens this student in Advising (the `open-advisee` intent); offered to advisees only. */
  onOpenAdvising?: (studentId: number) => void
  onClose: () => void
  onSaved: (s: Student) => void
}): React.JSX.Element {
  const [first, setFirst] = useState(student?.firstName ?? '')
  const [last, setLast] = useState(student?.lastName ?? '')
  const [preferred, setPreferred] = useState(student?.preferredName ?? '')
  const [email, setEmail] = useState(student?.email ?? '')
  const [notes, setNotes] = useState(student?.notes ?? '')
  const [tags, setTags] = useState(student?.tags.join(', ') ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const classes = useApiQuery<ClassSummary[]>(
    () => (student ? window.api.classes.forStudent(student.id) : Promise.resolve([])),
    [student?.id],
    ['enrollments.changed']
  )

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    try {
      const input = {
        firstName: first,
        lastName: last,
        preferredName: preferred,
        email,
        notes,
        tags: tags
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean)
      }
      let saved: Student
      if (student) saved = await window.api.students.update(student.id, input)
      else {
        saved = await window.api.students.create(input)
        if (enrollInClassId) await window.api.classes.enroll(enrollInClassId, saved.id)
      }
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!student) return
    const ok = window.confirm(
      'Delete this student everywhere? Their scores in every class are deleted too. To only take them out of one class, use Remove on the roster instead. A backup is taken first, so this can be undone from Settings in the Vault.'
    )
    if (!ok) return
    try {
      await window.api.students.delete(student.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      error={error}
      title={student ? 'Edit student' : 'New student'}
      onClose={onClose}
      footer={
        <>
          {student && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete student
            </button>
          )}
          <span className="spacer" />
          {student && onOpenAdvising && student.tags.includes('advisee') && (
            <button type="button" className="btn" onClick={() => onOpenAdvising(student.id)}>
              Open in Advising
            </button>
          )}
          {student && onOpenGradebook && (
            <button type="button" className="btn" onClick={() => onOpenGradebook(student.id)}>
              Open in Gradebook
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="student-form" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <form id="student-form" className="form" onSubmit={save}>
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
        <div className="form-row">
          <label>
            Preferred name
            <input value={preferred} onChange={(e) => setPreferred(e.target.value)} />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
        <label>
          Tags <span className="hint">(comma separated; use “advisee” for advisees)</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="advisee, iep"
          />
        </label>
        <label>
          Notes
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {student && (
          <p className="hint">
            In:{' '}
            {classes.data && classes.data.length > 0
              ? classes.data.map((c) => `${classLabel(c)} (${c.termName})`).join('; ')
              : 'no classes'}
          </p>
        )}
      </form>
    </Modal>
  )
}
