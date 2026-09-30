import type Database from 'better-sqlite3'
import type { ChangeName } from '@shared/events'
import { openPublicDatabase, openVaultDatabase } from '../../src/main/db/connection'
import {
  createPublicRepositories,
  createVaultRepositories,
  type PublicRepositories,
  type Repositories
} from '../../src/main/repos'

export interface TestEnv {
  db: Database.Database
  repos: Repositories
  events: { name: ChangeName; classId?: number }[]
}

/** A fresh in-memory vault database with migrations applied and an event log. */
export function makeEnv(): TestEnv {
  const db = openVaultDatabase(':memory:')
  const events: TestEnv['events'] = []
  const repos = createVaultRepositories(db, (name, detail) => events.push({ name, ...detail }))
  return { db, repos, events }
}

/** A fresh in-memory public database (settings only) and an event log. */
export function makePublicEnv(): {
  db: Database.Database
  repos: PublicRepositories
  events: TestEnv['events']
} {
  const db = openPublicDatabase(':memory:')
  const events: TestEnv['events'] = []
  const repos = createPublicRepositories(db, (name, detail) => events.push({ name, ...detail }))
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
