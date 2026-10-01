import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScoreInput } from '@shared/api'
import type { Assignment, ClassRecord, GradeCategory, Score, Student } from '@shared/models'
import { useChangeEvent } from '@renderer/data/hooks'

export interface GradebookData {
  cls: ClassRecord
  students: Student[]
  categories: GradeCategory[]
  assignments: Assignment[]
  /** Keyed by `${assignmentId}:${studentId}`. */
  scores: Map<string, Score>
}

export const scoreKey = (assignmentId: number, studentId: number): string =>
  `${assignmentId}:${studentId}`

const EVENTS = [
  'students.changed',
  'classes.changed',
  'enrollments.changed',
  'categories.changed',
  'assignments.changed',
  'scores.changed'
] as const

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Everything the gradebook shows for one class, kept current from change events. Score edits apply
 * immediately on screen and are saved in the background; while saves are in flight a refetch is
 * held back so a slower, older answer can never flash an old value over a newer edit.
 */
export function useGradebook(classId: number | null) {
  const [state, setState] = useState<{ classId: number; data: GradebookData } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(0)
  const stale = useRef(false)
  const wanted = useRef(classId)
  useEffect(() => {
    wanted.current = classId
  }, [classId])

  const load = useCallback((id: number): void => {
    if (inFlight.current > 0) {
      stale.current = true
      return
    }
    Promise.all([
      window.api.classes.get(id),
      window.api.classes.roster(id),
      window.api.grading.categories(id),
      window.api.grading.assignments(id),
      window.api.grading.scores(id)
    ])
      .then(([cls, students, categories, assignments, scores]) => {
        if (wanted.current !== id) return
        if (!cls) {
          setState(null)
          return
        }
        setState({
          classId: id,
          data: {
            cls,
            students,
            categories,
            assignments,
            scores: new Map(scores.map((s) => [scoreKey(s.assignmentId, s.studentId), s]))
          }
        })
        setError(null)
      })
      .catch((e: unknown) => {
        if (wanted.current === id) setError(msg(e))
      })
  }, [])

  useEffect(() => {
    if (classId !== null) load(classId)
  }, [classId, load])

  useChangeEvent(EVENTS, (e) => {
    if (classId !== null && (e.classId === undefined || e.classId === classId)) load(classId)
  })

  const saveScore = useCallback(
    async (input: ScoreInput): Promise<void> => {
      setState((prev) => {
        if (!prev) return prev
        const scores = new Map(prev.data.scores)
        const key = scoreKey(input.assignmentId, input.studentId)
        const comment = input.comment ?? ''
        if (input.points === null && input.status === null && comment === '') scores.delete(key)
        else {
          scores.set(key, {
            id: scores.get(key)?.id ?? -1,
            assignmentId: input.assignmentId,
            studentId: input.studentId,
            points: input.points,
            status: input.status,
            comment
          })
        }
        return { ...prev, data: { ...prev.data, scores } }
      })
      inFlight.current++
      try {
        await window.api.grading.setScore(input)
      } catch (e) {
        setError(msg(e))
        stale.current = true // put the screen back to what is actually saved
      } finally {
        inFlight.current--
        if (inFlight.current === 0 && stale.current && wanted.current !== null) {
          stale.current = false
          load(wanted.current)
        }
      }
    },
    [load]
  )

  return {
    data: state && state.classId === classId ? state.data : null,
    error,
    clearError: () => setError(null),
    saveScore
  }
}
