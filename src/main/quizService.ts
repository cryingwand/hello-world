import { writeFile } from 'node:fs/promises'
import { localToday } from '@shared/advising'
import { QUIZ_VERSIONS, type QuizVersion } from '@shared/quiz'
import { quizDocx } from './quizDoc'
import type { Repositories } from './repos'
import { safeName } from './rosterService'
import * as v from './validate'

export interface QuizDeps {
  pickSaveFile: (defaultName: string) => Promise<string | null>
  today?: () => string
}

export function createQuizService(repos: Repositories, deps: QuizDeps) {
  const today = deps.today ?? localToday
  return {
    /** Asks where to save, then writes the Word copy. Null if the save was cancelled. */
    async exportWord(rawId: number, version: QuizVersion): Promise<{ path: string } | null> {
      const id = v.id(rawId)
      const kind = v.oneOf(version, QUIZ_VERSIONS, 'Version')
      const quiz = repos.quizzes.get(id)
      if (!quiz) throw new v.ValidationError('That quiz no longer exists')
      if (quiz.entries.length === 0) throw new v.ValidationError('Add some questions first')

      const label = [today(), quiz.course, quiz.title, kind === 'key' ? 'Answer Key' : '']
        .filter((p) => p !== '')
        .join(' ')
      const picked = await deps.pickSaveFile(`${safeName(label)}.docx`)
      if (!picked) return null
      const path = /\.docx$/i.test(picked) ? picked : `${picked}.docx`
      await writeFile(path, await quizDocx(quiz, kind))
      return { path }
    }
  }
}

export type QuizService = ReturnType<typeof createQuizService>
