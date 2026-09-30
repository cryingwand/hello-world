import { useMemo } from 'react'
import type { ScoreInput } from '@shared/api'
import { computeStudentGrade, formatPercent, formatPoints } from '@shared/grades'
import type { Score, ScoreStatus } from '@shared/models'
import Sensitive from '@renderer/components/Sensitive'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'
import { scoreKey, type GradebookData } from './useGradebook'

/** One student across a class: every score, flag and comment, with the grade worked out. */
export default function StudentDetail({
  studentId,
  data,
  onSave,
  onBack,
  onChangeClass
}: {
  studentId: number
  data: GradebookData
  onSave: (input: ScoreInput) => void
  onBack: () => void
  onChangeClass: (classId: number) => void
}): React.JSX.Element {
  const { cls, students, assignments, categories, scores } = data
  const student = students.find((s) => s.id === studentId)
  const classes = useApiQuery(
    () => window.api.classes.forStudent(studentId),
    [studentId],
    ['enrollments.changed', 'classes.changed']
  )

  const grade = useMemo(() => {
    const mine = new Map<number, Score>()
    for (const a of assignments) {
      const s = scores.get(scoreKey(a.id, studentId))
      if (s) mine.set(a.id, s)
    }
    return computeStudentGrade(cls.gradingMode, assignments, categories, mine)
  }, [assignments, categories, scores, cls.gradingMode, studentId])

  if (!student) {
    return (
      <div className="pad">
        <button className="btn" onClick={onBack}>
          ← Back to scores
        </button>
        <p className="hint pad">This student is not in this class.</p>
      </div>
    )
  }

  const save = (
    aId: number,
    patch: Partial<Pick<Score, 'points' | 'status' | 'comment'>>
  ): void => {
    const cur = scores.get(scoreKey(aId, studentId))
    onSave({
      assignmentId: aId,
      studentId,
      points: patch.points !== undefined ? patch.points : (cur?.points ?? null),
      status: patch.status !== undefined ? patch.status : (cur?.status ?? null),
      comment: patch.comment !== undefined ? patch.comment : (cur?.comment ?? '')
    })
  }

  return (
    <div className="student-detail">
      <div className="pane-head">
        <div>
          <button className="btn btn-quiet" onClick={onBack}>
            ← Back to scores
          </button>
          <h2>
            <Sensitive>{[student.firstName, student.lastName].filter(Boolean).join(' ')}</Sensitive>
          </h2>
          <div className="hint">
            {(classes.data ?? []).length > 1 ? (
              <label className="inline">
                Class
                <select
                  value={cls.id}
                  onChange={(e) => onChangeClass(Number(e.target.value))}
                  aria-label="Class"
                >
                  {(classes.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {classLabel(c)} ({c.termName})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              classLabel(cls)
            )}
          </div>
        </div>
        <div className="big-grade" aria-label="Overall grade">
          <div className="big-number">
            <Sensitive>{formatPercent(grade.percent)}</Sensitive>
          </div>
          <div className="hint">
            {cls.gradingMode === 'points'
              ? `${formatPoints(grade.earned)} of ${formatPoints(grade.possible)} points`
              : 'weighted'}
          </div>
        </div>
      </div>

      <p className="counts hint">
        {grade.counts.graded} graded · {grade.counts.missing} missing · {grade.counts.late} late ·{' '}
        {grade.counts.excused} excused · {grade.counts.ungraded} not yet graded
      </p>
      {cls.gradingMode === 'weighted' && grade.uncategorized > 0 && (
        <p className="hint warn">
          {grade.uncategorized} graded assignment(s) have no category and are not counted.
        </p>
      )}

      {cls.gradingMode === 'weighted' && (
        <table className="grid-table compact-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Weight</th>
              <th>Points</th>
              <th>Percent</th>
            </tr>
          </thead>
          <tbody>
            {grade.categories.map((c) => (
              <tr key={c.categoryId}>
                <td>{c.name}</td>
                <td>{formatPoints(c.weight)}%</td>
                <td>
                  {c.possible > 0 ? `${formatPoints(c.earned)} / ${formatPoints(c.possible)}` : ''}
                </td>
                <td>
                  <Sensitive>{formatPercent(c.percent)}</Sensitive>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="table-scroll">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Assignment</th>
              <th>Score</th>
              <th>Out of</th>
              <th>Flag</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => {
              const s = scores.get(scoreKey(a.id, studentId))
              return (
                <tr key={a.id}>
                  <td>
                    {a.title}
                    <div className="hint">
                      {categories.find((c) => c.id === a.categoryId)?.name ?? ''}
                    </div>
                  </td>
                  <td>
                    <Sensitive>
                      <input
                        key={`${s?.points}:${s?.status}`}
                        className="narrow"
                        defaultValue={formatPoints(s?.points)}
                        inputMode="decimal"
                        aria-label={`Score for ${a.title}`}
                        onBlur={(e) => {
                          const t = e.currentTarget.value.trim()
                          if (t === formatPoints(s?.points)) return
                          if (t === '')
                            return save(a.id, {
                              points: null,
                              status: s?.status === 'late' ? null : (s?.status ?? null)
                            })
                          const n = Number(t)
                          if (!Number.isFinite(n) || n < 0) {
                            e.currentTarget.value = formatPoints(s?.points)
                            return
                          }
                          save(a.id, { points: n, status: s?.status === 'late' ? 'late' : null })
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                    </Sensitive>
                  </td>
                  <td>{formatPoints(a.pointsPossible)}</td>
                  <td>
                    <select
                      value={s?.status ?? ''}
                      aria-label={`Flag for ${a.title}`}
                      onChange={(e) => {
                        const status = (e.target.value || null) as ScoreStatus | null
                        save(a.id, {
                          status,
                          points:
                            status === 'missing' || status === 'excused'
                              ? null
                              : (s?.points ?? null)
                        })
                      }}
                    >
                      <option value="">none</option>
                      <option value="missing">missing</option>
                      <option value="excused">excused</option>
                      <option value="late">late</option>
                    </select>
                  </td>
                  <td>
                    <Sensitive>
                      <input
                        key={s?.comment}
                        className="wide"
                        defaultValue={s?.comment ?? ''}
                        aria-label={`Comment for ${a.title}`}
                        onBlur={(e) =>
                          e.currentTarget.value.trim() !== (s?.comment ?? '') &&
                          save(a.id, { comment: e.currentTarget.value.trim() })
                        }
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                    </Sensitive>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
