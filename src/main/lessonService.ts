import { writeFile } from 'node:fs/promises'
import { localToday } from '@shared/advising'
import { lessonDeck } from './lessonDeck'
import type { Repositories } from './repos'
import { safeName } from './rosterService'
import * as v from './validate'

export interface LessonDeps {
  pickSaveFile: (defaultName: string) => Promise<string | null>
  today?: () => string
}

export function createLessonService(repos: Repositories, deps: LessonDeps) {
  const today = deps.today ?? localToday
  return {
    /** Asks where to save, then writes the deck for a unit, or for one lesson. Null if cancelled. */
    async exportPowerPoint(
      rawId: number,
      rawLessonId?: number | null
    ): Promise<{ path: string } | null> {
      const id = v.id(rawId)
      const lessonId = rawLessonId == null ? null : v.id(rawLessonId, 'Lesson')
      const unit = repos.units.get(id)
      if (!unit) throw new v.ValidationError('That unit no longer exists')
      if (unit.lessons.length === 0) throw new v.ValidationError('Add a lesson first')
      const lesson = lessonId === null ? null : unit.lessons.find((l) => l.id === lessonId)
      if (lessonId !== null && !lesson) {
        throw new v.ValidationError('That lesson is not in this unit')
      }

      const label = [today(), unit.course, unit.title, lesson?.title ?? '']
        .filter((p) => p !== '')
        .join(' ')
      const picked = await deps.pickSaveFile(`${safeName(label)}.pptx`)
      if (!picked) return null
      const path = /\.pptx$/i.test(picked) ? picked : `${picked}.pptx`
      await writeFile(path, await lessonDeck(unit, lessonId))
      return { path }
    }
  }
}

export type LessonService = ReturnType<typeof createLessonService>
