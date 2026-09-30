import { useState } from 'react'
import { formatPoints } from '@shared/grades'
import type { Assignment, GradeCategory, GradingMode } from '@shared/models'
import type { GradebookData } from './useGradebook'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function CategoryRow({
  cat,
  onError
}: {
  cat: GradeCategory
  onError: (m: string) => void
}): React.JSX.Element {
  const [name, setName] = useState(cat.name)
  const [weight, setWeight] = useState(String(cat.weight))
  const save = (): void => {
    const w = Number(weight)
    if (name.trim() === cat.name && w === cat.weight) return
    if (!Number.isFinite(w) || w < 0) {
      onError('Weight must be a number, 0 or more')
      setWeight(String(cat.weight))
      return
    }
    window.api.grading.updateCategory(cat.id, { name, weight: w }).catch((e: unknown) => {
      onError(msg(e))
      setName(cat.name)
      setWeight(String(cat.weight))
    })
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }
  return (
    <tr>
      <td>
        <input
          value={name}
          aria-label={`Name of ${cat.name}`}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={onKey}
        />
      </td>
      <td>
        <input
          className="narrow"
          value={weight}
          inputMode="decimal"
          aria-label={`Weight of ${cat.name}`}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={save}
          onKeyDown={onKey}
        />{' '}
        %
      </td>
      <td className="right">
        <button
          className="btn btn-quiet"
          onClick={() => {
            if (
              window.confirm(
                `Delete the “${cat.name}” category? Its assignments stay, but become uncategorised.`
              )
            ) {
              window.api.grading.deleteCategory(cat.id).catch((e: unknown) => onError(msg(e)))
            }
          }}
        >
          Delete
        </button>
      </td>
    </tr>
  )
}

export default function SetupTab({
  data,
  onEditAssignment,
  onNewAssignment
}: {
  data: GradebookData
  onEditAssignment: (a: Assignment) => void
  onNewAssignment: () => void
}): React.JSX.Element {
  const { cls, categories, assignments } = data
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newWeight, setNewWeight] = useState('')

  const setMode = (mode: GradingMode): void => {
    if (mode !== cls.gradingMode)
      window.api.classes
        .update(cls.id, { gradingMode: mode })
        .catch((e: unknown) => setError(msg(e)))
  }
  const addCategory = (e: React.FormEvent): void => {
    e.preventDefault()
    const w = newWeight.trim() === '' ? 0 : Number(newWeight)
    if (!Number.isFinite(w) || w < 0) return setError('Weight must be a number, 0 or more')
    window.api.grading
      .createCategory({ classId: cls.id, name: newName, weight: w })
      .then(() => {
        setNewName('')
        setNewWeight('')
        setError(null)
      })
      .catch((err: unknown) => setError(msg(err)))
  }

  const total = categories.reduce((a, c) => a + c.weight, 0)
  const uncategorised = assignments.filter((a) => a.categoryId === null).length

  return (
    <div className="setup">
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="btn btn-quiet" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section>
        <h3>How this class is graded</h3>
        <label className="check">
          <input
            type="radio"
            name="grading-mode"
            checked={cls.gradingMode === 'points'}
            onChange={() => setMode('points')}
          />
          <span>
            Total points <span className="hint">(all points earned ÷ all points possible)</span>
          </span>
        </label>
        <label className="check">
          <input
            type="radio"
            name="grading-mode"
            checked={cls.gradingMode === 'weighted'}
            onChange={() => setMode('weighted')}
          />
          <span>
            Weighted categories <span className="hint">(each category’s percent, weighted)</span>
          </span>
        </label>
      </section>

      <section>
        <h3>Categories</h3>
        {cls.gradingMode === 'points' && (
          <p className="hint">
            Categories are optional for a points class. They are for organising, and do not change
            the grade.
          </p>
        )}
        <table className="grid-table setup-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Weight</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <CategoryRow key={`${c.id}:${c.name}:${c.weight}`} cat={c} onError={setError} />
            ))}
            {categories.length === 0 && (
              <tr>
                <td colSpan={3} className="hint">
                  No categories yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <form className="row" onSubmit={addCategory}>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New category, e.g. Tests"
                    aria-label="New category name"
                  />
                  <input
                    className="narrow"
                    value={newWeight}
                    onChange={(e) => setNewWeight(e.target.value)}
                    placeholder="Weight"
                    inputMode="decimal"
                    aria-label="New category weight"
                  />{' '}
                  %
                  <button className="btn" type="submit" disabled={!newName.trim()}>
                    Add category
                  </button>
                </form>
              </td>
            </tr>
          </tfoot>
        </table>
        {cls.gradingMode === 'weighted' && categories.length > 0 && (
          <p className={total === 100 ? 'hint' : 'hint warn'}>
            Weights add up to {formatPoints(total)}%.{' '}
            {total === 100
              ? ''
              : 'They do not have to reach 100; they are scaled to fit, and categories with no grades yet are left out.'}
          </p>
        )}
        {cls.gradingMode === 'weighted' && categories.length === 0 && (
          <p className="hint warn">
            A weighted class needs categories, or no grade can be worked out.
          </p>
        )}
      </section>

      <section>
        <div className="row">
          <h3>Assignments</h3>
          <span className="spacer" />
          <button className="btn" onClick={onNewAssignment}>
            + Assignment
          </button>
        </div>
        {cls.gradingMode === 'weighted' && uncategorised > 0 && (
          <p className="hint warn">
            {uncategorised} assignment{uncategorised === 1 ? ' has' : 's have'} no category and{' '}
            {uncategorised === 1 ? 'is' : 'are'} not counted in the weighted grade.
          </p>
        )}
        <table className="grid-table setup-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Points</th>
              <th>Due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>
                  {categories.find((c) => c.id === a.categoryId)?.name ?? (
                    <span className="hint">none</span>
                  )}
                </td>
                <td>{formatPoints(a.pointsPossible)}</td>
                <td>{a.dueDate ?? ''}</td>
                <td className="right">
                  <button className="btn btn-quiet" onClick={() => onEditAssignment(a)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {assignments.length === 0 && (
              <tr>
                <td colSpan={5} className="hint">
                  No assignments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
