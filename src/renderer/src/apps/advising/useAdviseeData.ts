import type { ActionItem, AdvisingGoal, AdvisingMeeting, ExternalProgress } from '@shared/models'
import { useApiQuery, type Query } from '@renderer/data/hooks'

export interface AdviseeData {
  meetings: Query<AdvisingMeeting[]>
  goals: Query<AdvisingGoal[]>
  actions: Query<ActionItem[]>
  progress: Query<ExternalProgress[]>
}

const EVENTS = ['advising.changed'] as const

/** Everything recorded about one advisee; refetches whenever advising data changes anywhere. */
export function useAdviseeData(studentId: number): AdviseeData {
  return {
    meetings: useApiQuery(() => window.api.advising.meetings(studentId), [studentId], EVENTS),
    goals: useApiQuery(() => window.api.advising.goals(studentId), [studentId], EVENTS),
    actions: useApiQuery(() => window.api.advising.actions(studentId), [studentId], EVENTS),
    progress: useApiQuery(() => window.api.advising.progress(studentId), [studentId], EVENTS)
  }
}
