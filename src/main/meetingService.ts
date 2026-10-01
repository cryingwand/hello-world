import { writeFile } from 'node:fs/promises'
import { studentDisplayName } from '@shared/advising'
import { meetingDocx } from './meetingDoc'
import type { Repositories } from './repos'
import { safeName } from './rosterService'
import * as v from './validate'

export interface MeetingDeps {
  pickSaveFile: (defaultName: string) => Promise<string | null>
}

export function createMeetingService(repos: Repositories, deps: MeetingDeps) {
  return {
    /** Asks where to save, then writes the meeting up as a Word file. Null if cancelled. */
    async exportWord(rawId: number): Promise<{ path: string } | null> {
      const id = v.id(rawId)
      const meeting = repos.advising.meeting(id)
      if (!meeting) throw new v.ValidationError('That meeting no longer exists')
      const student = repos.students.get(meeting.studentId)
      if (!student) throw new v.ValidationError('That student no longer exists')
      const name = studentDisplayName(student)
      if (!meeting.summary.trim() && !meeting.notes.trim()) {
        throw new v.ValidationError('Write some notes or a summary first')
      }
      const followUps = repos.advising.actions(student.id).filter((a) => a.meetingId === id)

      const picked = await deps.pickSaveFile(
        `${safeName(`${meeting.metOn} Advising meeting ${name}`)}.docx`
      )
      if (!picked) return null
      const path = /\.docx$/i.test(picked) ? picked : `${picked}.docx`
      await writeFile(path, await meetingDocx({ studentName: name, meeting, followUps }))
      return { path }
    }
  }
}

export type MeetingService = ReturnType<typeof createMeetingService>
