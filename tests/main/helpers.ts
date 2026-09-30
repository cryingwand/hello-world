import type Database from 'better-sqlite3'
import type { ChangeName } from '@shared/events'
import { openDatabase } from '../../src/main/db/connection'
import { createRepositories, type Repositories } from '../../src/main/repos'

export interface TestEnv {
  db: Database.Database
  repos: Repositories
  events: { name: ChangeName; classId?: number }[]
}

/** A fresh in-memory database with migrations applied and an event log. */
export function makeEnv(): TestEnv {
  const db = openDatabase(':memory:')
  const events: TestEnv['events'] = []
  const repos = createRepositories(db, (name, detail) => events.push({ name, ...detail }))
  return { db, repos, events }
}

/** A term, a class, and `n` enrolled students, ready for gradebook tests. */
export function seedClass(env: TestEnv, n = 3, gradingMode: 'weighted' | 'points' = 'points') {
  const term = env.repos.terms.create({ name: 'Fall 2026', isCurrent: true })
  const cls = env.repos.classes.create({
    termId: term.id,
    course: 'History',
    period: '3',
    gradingMode
  })
  const students = Array.from({ length: n }, (_, i) =>
    env.repos.students.create({ firstName: `First${i}`, lastName: `Last${i}` })
  )
  for (const s of students) env.repos.classes.enroll(cls.id, s.id)
  env.events.length = 0
  return { term, cls, students }
}
