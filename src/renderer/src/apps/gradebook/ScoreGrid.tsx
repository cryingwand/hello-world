import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScoreInput } from '@shared/api'
import {
  assignmentStats,
  classAverage,
  computeStudentGrade,
  formatPercent,
  formatPoints
} from '@shared/grades'
import type { Assignment, Score, ScoreStatus } from '@shared/models'
import { parseScoreCell } from '@shared/scoreImport'
import Sensitive, { useMasked } from '@renderer/components/Sensitive'
import { scoreKey, type GradebookData } from './useGradebook'

interface Cell {
  r: number
  c: number
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

function cellText(s: Score | undefined): string {
  if (!s) return ''
  if (s.status === 'missing') return 'M'
  if (s.status === 'excused') return 'EX'
  return formatPoints(s.points)
}

export interface FocusRequest {
  assignmentId: number
  studentId: number
  nonce: number
}

/**
 * The score-entry grid. Arrow keys move; type a number to enter it; Enter saves and moves down,
 * Tab saves and moves right, Esc cancels. M, X and L toggle missing, excused and late; Delete clears.
 */
export default function ScoreGrid({
  data,
  onSave,
  onOpenStudent,
  onEditAssignment,
  focusRequest
}: {
  data: GradebookData
  onSave: (input: ScoreInput) => void
  onOpenStudent: (studentId: number) => void
  onEditAssignment: (a: Assignment) => void
  focusRequest?: FocusRequest
}): React.JSX.Element {
  const { cls, students, assignments, categories, scores } = data
  const rows = students.length
  const cols = assignments.length
  const wrap = useRef<HTMLDivElement>(null)
  const masked = useMasked()
  const [pos, setPos] = useState<Cell>({ r: 0, c: 0 })
  const [editing, setEditing] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const finishing = useRef(false)
  // Presenting starts: drop a half-typed score rather than carry it across.
  if (masked && editing !== null) {
    setEditing(null)
    setInvalid(false)
  }
  const wasEditing = useRef(false)

  // Keep the cursor on the grid if rows or columns disappear.
  const active: Cell = {
    r: clamp(pos.r, 0, Math.max(rows - 1, 0)),
    c: clamp(pos.c, 0, Math.max(cols - 1, 0))
  }

  // A request from another app (the `record-score` intent) to land on a particular cell.
  const [handledFocus, setHandledFocus] = useState<number | undefined>(undefined)
  if (focusRequest && focusRequest.nonce !== handledFocus) {
    const r = students.findIndex((s) => s.id === focusRequest.studentId)
    const c = assignments.findIndex((a) => a.id === focusRequest.assignmentId)
    if (r !== -1 && c !== -1) {
      setHandledFocus(focusRequest.nonce)
      setPos({ r, c })
    }
  }

  useEffect(() => {
    wrap.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active.r, active.c])

  useEffect(() => {
    if (focusRequest) wrap.current?.focus()
  }, [focusRequest])

  // After an edit ends, return keyboard focus to the grid so navigation keeps working.
  useEffect(() => {
    if (editing === null && wasEditing.current) wrap.current?.focus()
    wasEditing.current = editing !== null
  }, [editing])

  const grades = useMemo(() => {
    const byStudent = students.map((st) => {
      const mine = new Map<number, Score>()
      for (const a of assignments) {
        const s = scores.get(scoreKey(a.id, st.id))
        if (s) mine.set(a.id, s)
      }
      return computeStudentGrade(cls.gradingMode, assignments, categories, mine)
    })
    return { byStudent, average: classAverage(byStudent.map((g) => g.percent)) }
  }, [students, assignments, categories, scores, cls.gradingMode])

  const move = (dr: number, dc: number): void =>
    setPos({ r: clamp(active.r + dr, 0, rows - 1), c: clamp(active.c + dc, 0, cols - 1) })

  const write = (r: number, c: number, points: number | null, status: ScoreStatus | null): void => {
    const st = students[r]
    const a = assignments[c]
    onSave({
      assignmentId: a.id,
      studentId: st.id,
      points,
      status,
      comment: scores.get(scoreKey(a.id, st.id))?.comment ?? ''
    })
  }

  const toggleStatus = (status: ScoreStatus): void => {
    const cur = scores.get(scoreKey(assignments[active.c].id, students[active.r].id))
    if (status === 'late') {
      // Late is only a flag on real points; it never replaces them.
      write(active.r, active.c, cur?.points ?? null, cur?.status === 'late' ? null : 'late')
    } else {
      write(active.r, active.c, null, cur?.status === status ? null : status)
    }
  }

  /** Saves what was typed. Returns false (and stays in the cell) when it is not a valid score. */
  const commit = (text: string): boolean => {
    const cell = parseScoreCell(text)
    if (cell.kind === 'invalid') {
      setInvalid(true)
      return false
    }
    const cur = scores.get(scoreKey(assignments[active.c].id, students[active.r].id))
    if (cell.kind === 'blank') write(active.r, active.c, null, null)
    else if (cell.kind === 'points')
      write(active.r, active.c, cell.points, cur?.status === 'late' ? 'late' : null)
    else write(active.r, active.c, null, cell.status)
    return true
  }

  const finish = (text: string, dr: number, dc: number): void => {
    if (finishing.current) return
    finishing.current = true
    if (commit(text)) {
      setEditing(null)
      setInvalid(false)
      move(dr, dc)
    }
    finishing.current = false
  }

  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || rows === 0 || cols === 0) return
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey
    let handled = true
    switch (e.key) {
      case 'ArrowDown':
        move(1, 0)
        break
      case 'ArrowUp':
        move(-1, 0)
        break
      case 'ArrowRight':
        move(0, 1)
        break
      case 'ArrowLeft':
        move(0, -1)
        break
      case 'Tab':
        if (
          e.shiftKey
            ? active.c === 0 && active.r === 0
            : active.c === cols - 1 && active.r === rows - 1
        )
          return // let focus leave
        move(0, e.shiftKey ? -1 : 1)
        break
      case 'Home':
        setPos({ r: active.r, c: 0 })
        break
      case 'End':
        setPos({ r: active.r, c: cols - 1 })
        break
      case 'Enter':
      case 'F2':
        setEditing(cellText(scores.get(scoreKey(assignments[active.c].id, students[active.r].id))))
        break
      case 'Delete':
      case 'Backspace': {
        const cur = scores.get(scoreKey(assignments[active.c].id, students[active.r].id))
        if (cur) write(active.r, active.c, null, null)
        break
      }
      default:
        if (plain && /^[0-9.]$/.test(e.key)) setEditing(e.key)
        else if (plain && /^[mM]$/.test(e.key)) toggleStatus('missing')
        else if (plain && /^[xX]$/.test(e.key)) toggleStatus('excused')
        else if (plain && /^[lL]$/.test(e.key)) toggleStatus('late')
        else handled = false
    }
    if (handled) e.preventDefault()
  }

  if (rows === 0)
    return (
      <p className="hint pad">
        This class has no students yet. Add or import a roster in Classes & Rosters.
      </p>
    )
  if (cols === 0)
    return (
      <p className="hint pad">No assignments yet. Choose “+ Assignment” to add the first one.</p>
    )

  return (
    <div
      className="grid-wrap"
      ref={wrap}
      tabIndex={0}
      role="grid"
      aria-label="Scores"
      aria-rowcount={rows + 1}
      aria-colcount={cols + 2}
      onKeyDown={onGridKey}
    >
      <table className="score-grid">
        <thead>
          <tr>
            <th className="sticky-col corner">Student</th>
            {assignments.map((a) => {
              const cat = categories.find((c) => c.id === a.categoryId)
              return (
                <th
                  key={a.id}
                  className="asg-head"
                  title={`${a.title}\n${formatPoints(a.pointsPossible)} points${a.dueDate ? `\nDue ${a.dueDate}` : ''}`}
                >
                  <button className="asg-title" onClick={() => onEditAssignment(a)}>
                    {a.title}
                  </button>
                  <span className="asg-meta">
                    /{formatPoints(a.pointsPossible)}
                    {cat
                      ? ` · ${cat.name}`
                      : cls.gradingMode === 'weighted'
                        ? ' · no category'
                        : ''}
                  </span>
                </th>
              )
            })}
            <th className="avg-head">Average</th>
          </tr>
        </thead>
        <tbody>
          {students.map((st, r) => {
            const g = grades.byStudent[r]
            return (
              <tr key={st.id} role="row">
                <th className="sticky-col name" scope="row">
                  <button
                    className="name-btn"
                    onClick={() => onOpenStudent(st.id)}
                    title="Open student view"
                  >
                    <Sensitive>{[st.lastName, st.firstName].filter(Boolean).join(', ')}</Sensitive>
                  </button>
                </th>
                {assignments.map((a, c) => {
                  const s = scores.get(scoreKey(a.id, st.id))
                  const isActive = active.r === r && active.c === c
                  return (
                    <td
                      key={a.id}
                      role="gridcell"
                      data-active={isActive}
                      data-cell={`${r}-${c}`}
                      aria-selected={isActive}
                      className={`cell${isActive ? ' cell-active' : ''}${s?.status ? ` cell-${s.status}` : ''}`}
                      onClick={() => {
                        if (editing !== null && !isActive) finish(editing, 0, 0)
                        setPos({ r, c })
                        wrap.current?.focus()
                      }}
                      onDoubleClick={() => setEditing(cellText(s))}
                    >
                      {isActive && editing !== null && !masked ? (
                        <input
                          className={`cell-input${invalid ? ' cell-invalid' : ''}`}
                          autoFocus
                          value={editing}
                          aria-label={`Score for ${a.title}`}
                          onChange={(e) => {
                            setEditing(e.target.value)
                            setInvalid(false)
                          }}
                          onFocus={(e) =>
                            e.currentTarget.setSelectionRange(
                              e.currentTarget.value.length,
                              e.currentTarget.value.length
                            )
                          }
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              finish(e.currentTarget.value, e.shiftKey ? -1 : 1, 0)
                            } else if (e.key === 'Tab') {
                              e.preventDefault()
                              finish(e.currentTarget.value, 0, e.shiftKey ? -1 : 1)
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              setEditing(null)
                              setInvalid(false)
                            }
                          }}
                          onBlur={(e) => {
                            if (editing === null || finishing.current) return
                            // Clicking away saves a valid entry and quietly drops an invalid one.
                            if (parseScoreCell(e.currentTarget.value).kind === 'invalid') {
                              setEditing(null)
                              setInvalid(false)
                            } else finish(e.currentTarget.value, 0, 0)
                          }}
                        />
                      ) : (
                        <Sensitive placeholder="•">
                          {s?.status === 'missing' ? (
                            <span className="flag flag-missing">M</span>
                          ) : s?.status === 'excused' ? (
                            <span className="flag flag-excused">EX</span>
                          ) : (
                            <>
                              {formatPoints(s?.points)}
                              {s?.status === 'late' && <span className="flag flag-late">L</span>}
                            </>
                          )}
                          {s?.comment ? <span className="note-dot" title={s.comment} /> : null}
                        </Sensitive>
                      )}
                    </td>
                  )
                })}
                <td
                  className="avg-cell"
                  title={
                    masked
                      ? undefined
                      : g.percent === null
                        ? 'Nothing graded yet'
                        : cls.gradingMode === 'points'
                          ? `${formatPoints(g.earned)} of ${formatPoints(g.possible)} points`
                          : g.categories
                              .map(
                                (cat) =>
                                  `${cat.name} (${formatPoints(cat.weight)}%): ${formatPercent(cat.percent)}`
                              )
                              .join('\n')
                  }
                >
                  <Sensitive>{formatPercent(g.percent)}</Sensitive>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <th className="sticky-col name">Class average</th>
            {assignments.map((a) => {
              const st = assignmentStats(
                a,
                students.map((s) => scores.get(scoreKey(a.id, s.id)))
              )
              return (
                <td
                  key={a.id}
                  className="foot-cell"
                  title={st.counted ? `${st.counted} scores counted` : 'No scores yet'}
                >
                  <Sensitive placeholder="•">{formatPercent(st.averagePercent)}</Sensitive>
                </td>
              )
            })}
            <td className="avg-cell">
              <Sensitive>{formatPercent(grades.average)}</Sensitive>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="keys hint">
        Arrows move · type a score · Enter saves and moves down · Tab moves right · M missing · X
        excused · L late · Delete clears
      </p>
    </div>
  )
}
