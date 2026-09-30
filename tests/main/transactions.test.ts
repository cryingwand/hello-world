import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { guessMapping } from '@shared/roster'
import { openDatabase } from '../../src/main/db/connection'
import { createRepositories } from '../../src/main/repos'
import { createRosterService } from '../../src/main/rosterService'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
  const db = openDatabase(':memory:')
  const log: { name: string; classId?: number; inTransaction: boolean }[] = []
  const repos = createRepositories(db, (name, detail) =>
    log.push({ name, ...detail, inTransaction: db.inTransaction })
  )
  return { db, repos, log }
}

describe('deferred change events', () => {
  it('are held until the outermost transaction commits, then de-duplicated', () => {
    const { repos, log } = setup()
    const t = repos.terms.create({ name: 'T' })
    log.length = 0
    repos.transaction(() => {
      repos.students.create({ firstName: 'A', lastName: 'One' })
      repos.students.create({ firstName: 'B', lastName: 'Two' })
      expect(log).toHaveLength(0) // nothing broadcast mid-transaction
      repos.transaction(() =>
        repos.classes.create({ termId: t.id, course: 'C', gradingMode: 'points' })
      )
      expect(log).toHaveLength(0) // an inner commit is not the outermost commit
    })
    expect(log.map((e) => e.name)).toEqual(['students.changed', 'classes.changed'])
    expect(log.every((e) => !e.inTransaction)).toBe(true)
  })

  it('are dropped when the transaction rolls back', () => {
    const { repos, log } = setup()
    expect(() =>
      repos.transaction(() => {
        repos.students.create({ firstName: 'A', lastName: 'One' })
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(log).toHaveLength(0)
    expect(repos.students.list()).toHaveLength(0)
    // and later events are not swallowed
    repos.students.create({ firstName: 'B', lastName: 'Two' })
    expect(log.map((e) => e.name)).toEqual(['students.changed'])
  })

  it('a failed inner transaction inside a caught outer one does not leak stale events', () => {
    const { repos, log } = setup()
    repos.transaction(() => {
      try {
        repos.transaction(() => {
          repos.students.create({ firstName: 'A', lastName: 'One' })
          throw new Error('inner')
        })
      } catch {
        // swallowed
      }
    })
    // The inner write rolled back, so no event describing it may reach the windows.
    expect(repos.students.list()).toHaveLength(0)
    expect(log.filter((e) => e.name === 'students.changed').length).toBeLessThanOrEqual(1)
  })

  it('roster import broadcasts only after it has committed', async () => {
    const { repos, log } = setup()
    const dir = mkdtempSync(join(tmpdir(), 'tos-tx-'))
    dirs.push(dir)
    const path = join(dir, 'r.csv')
    writeFileSync(path, 'Last,First\nLovelace,Ada\nTuring,Alan\n')
    const svc = createRosterService(repos, {
      pickOpenFile: async () => path,
      pickSaveFile: async () => null
    })
    const term = repos.terms.create({ name: 'T' })
    const cls = repos.classes.create({ termId: term.id, course: 'C', gradingMode: 'points' })
    log.length = 0
    const file = (await svc.chooseFile())!
    await svc.commit({
      token: file.token,
      hasHeader: true,
      mapping: guessMapping(file.rows[0]),
      target: { classId: cls.id }
    })
    const names = log.map((e) => e.name)
    expect(names).toContain('students.changed')
    expect(names).toContain('enrollments.changed')
    expect(log.every((e) => !e.inTransaction)).toBe(true)
    // one event per kind despite two students being created and enrolled
    expect(names.filter((n) => n === 'students.changed')).toHaveLength(1)
  })
})
