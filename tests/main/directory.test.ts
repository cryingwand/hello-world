import { describe, expect, it } from 'vitest'
import { PUBLIC_ROSTER_COLUMNS } from '@shared/sensitive'
import { openVaultDatabase } from '../../src/main/db/connection'
import { createVaultRepositories } from '../../src/main/repos'
import { directoryRepo, type RosterSnapshot } from '../../src/main/repos/directory'
import { createRosterMirror, rosterSnapshot } from '../../src/main/rosterMirror'
import { makePublicEnv } from './helpers'

const snap = (over: Partial<RosterSnapshot['classes'][number]>[] = []): RosterSnapshot => ({
  classes: over.map((c, i) => ({
    id: i + 1,
    course: 'PHIL 101',
    section: '',
    period: String(i + 1),
    termName: 'Fall 2026',
    currentTerm: true,
    students: [],
    ...c
  }))
})
const person = (id: number, firstName: string, lastName: string, preferredName = '') => ({
  id,
  firstName,
  lastName,
  preferredName
})

describe('directory repository (the names-only roster copy)', () => {
  it('stores classes and students in the order given and reads them back', () => {
    const env = makePublicEnv()
    env.repos.directory.replace(
      snap([
        { id: 7, period: '3', students: [person(2, 'Ada', 'Zed'), person(1, 'Grace', 'Abel')] },
        { id: 4, period: '5', termName: 'Fall 2025', currentTerm: false, students: [] }
      ])
    )
    const classes = env.repos.directory.classes()
    expect(classes.map((c) => c.id)).toEqual([7, 4])
    expect(classes[0]).toMatchObject({
      course: 'PHIL 101',
      period: '3',
      termName: 'Fall 2026',
      currentTerm: true,
      studentCount: 2
    })
    expect(classes[1]).toMatchObject({ currentTerm: false, studentCount: 0 })
    expect(env.repos.directory.students(7).map((s) => s.name)).toEqual(['Ada Zed', 'Grace Abel'])
  })

  it('shows the preferred name in place of the first, and nothing but id and name', () => {
    const env = makePublicEnv()
    env.repos.directory.replace(snap([{ students: [person(1, 'Priya', 'Abernathy', 'Pri')] }]))
    expect(env.repos.directory.students(1)).toEqual([{ id: 1, name: 'Pri Abernathy' }])
  })

  it('announces a change to the everyday window, and only when something changed', () => {
    const env = makePublicEnv()
    const a = snap([{ students: [person(1, 'Ada', 'L')] }])
    expect(env.repos.directory.replace(a)).toBe(true)
    expect(env.events.map((e) => e.name)).toEqual(['directory.changed'])
    expect(env.repos.directory.replace(structuredClone(a))).toBe(false)
    expect(env.events).toHaveLength(1)
    expect(env.repos.directory.replace(snap([{ students: [person(1, 'Ada', 'M')] }]))).toBe(true)
    expect(env.events).toHaveLength(2)
  })

  it('removes classes and students that are gone, and can be emptied', () => {
    const env = makePublicEnv()
    env.repos.directory.replace(snap([{ students: [person(1, 'A', 'A')] }, { students: [] }]))
    env.repos.directory.replace(snap([{ id: 2 }]))
    expect(env.repos.directory.classes().map((c) => c.id)).toEqual([2])
    expect(env.repos.directory.students(1)).toEqual([])
    env.repos.directory.replace({ classes: [] })
    expect(env.repos.directory.classes()).toEqual([])
    expect(env.db.prepare('SELECT COUNT(*) AS n FROM roster_members').get()).toEqual({ n: 0 })
  })

  it('is all or nothing: a bad snapshot leaves the old copy and announces nothing', () => {
    const env = makePublicEnv()
    env.repos.directory.replace(snap([{ students: [person(1, 'Ada', 'L')] }]))
    env.events.length = 0
    const bad = snap([{ id: 5 }, { id: 5 }]) // the same class twice
    expect(() => env.repos.directory.replace(bad)).toThrow()
    expect(env.repos.directory.students(1).map((s) => s.name)).toEqual(['Ada L'])
    expect(env.events).toEqual([])
  })

  it('refuses an id that is not one, and returns an empty list for a class it does not have', () => {
    const env = makePublicEnv()
    expect(() => env.repos.directory.students('x' as never)).toThrow(/valid id/)
    expect(env.repos.directory.students(99)).toEqual([])
  })
})

describe('what the roster copy is allowed to hold', () => {
  it('has exactly the columns on the allowlist, so email, notes and tags cannot be added by accident', () => {
    const env = makePublicEnv()
    const tables = (
      env.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'roster_%' ORDER BY name"
        )
        .all() as { name: string }[]
    ).map((t) => t.name)
    expect(tables).toEqual(Object.keys(PUBLIC_ROSTER_COLUMNS).sort())
    for (const [table, cols] of Object.entries(PUBLIC_ROSTER_COLUMNS)) {
      const real = (env.db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
      expect(real.sort(), table).toEqual([...cols].sort())
    }
  })
})

/** A vault with a roster that also holds everything that must NOT leave it. */
function vaultWithSecrets() {
  const pub = makePublicEnv()
  const vdb = openVaultDatabase(':memory:')
  let mirror: ReturnType<typeof createRosterMirror> | null = null
  const repos = createVaultRepositories(vdb, (name) => mirror?.handle(name))
  mirror = createRosterMirror(repos, pub.repos.directory)
  const term = repos.terms.create({ name: 'Fall 2026', isCurrent: true })
  const cls = repos.classes.create({
    termId: term.id,
    course: 'PHIL 101',
    period: '3',
    gradingMode: 'points'
  })
  const pri = repos.students.create({
    firstName: 'Priya',
    lastName: 'Abernathy',
    preferredName: 'Pri',
    email: 'priya.secret@example.org',
    notes: 'Struggles with anxiety; mother is a teacher here',
    tags: ['advisee', 'iep']
  })
  repos.classes.enroll(cls.id, pri.id)
  // An advisee who is in no class: nothing about them may appear outside the Vault.
  const loner = repos.students.create({
    firstName: 'Zelda',
    lastName: 'Unenrolled',
    email: 'zelda.secret@example.org',
    tags: ['advisee']
  })
  const hw = repos.grading.createAssignment({
    classId: cls.id,
    title: 'Secret Midterm Essay',
    pointsPossible: 100
  })
  repos.grading.setScore({
    assignmentId: hw.id,
    studentId: pri.id,
    points: 41,
    status: null,
    comment: 'Plagiarised the intro'
  })
  repos.advising.createMeeting({
    studentId: pri.id,
    metOn: '2026-10-01',
    topic: 'Family difficulties',
    notes: 'Confidential notes about home life'
  })
  return { pub, repos, mirror, term, cls, pri, loner }
}

describe('what leaves the Vault', () => {
  const dump = (pub: ReturnType<typeof makePublicEnv>): string =>
    JSON.stringify({
      classes: pub.db.prepare('SELECT * FROM roster_classes').all(),
      members: pub.db.prepare('SELECT * FROM roster_members').all(),
      settings: pub.db.prepare('SELECT * FROM settings').all()
    })

  it('is names and class labels only', () => {
    const { pub } = vaultWithSecrets()
    const copy = dump(pub)
    expect(copy).toContain('Priya')
    expect(copy).toContain('Abernathy')
    expect(copy).toContain('PHIL 101')
  })

  it('never includes email, notes, tags, grades, comments or advising', () => {
    const { pub } = vaultWithSecrets()
    const copy = dump(pub)
    for (const secret of [
      'secret@example.org',
      'anxiety',
      'mother',
      'advisee',
      'iep',
      'Secret Midterm Essay',
      'Plagiarised',
      'Family difficulties',
      'Confidential',
      '41'
    ]) {
      expect(copy, secret).not.toContain(secret)
    }
  })

  it('leaves out a student who is in no class, even an advisee', () => {
    const { pub } = vaultWithSecrets()
    const copy = dump(pub)
    expect(copy).not.toContain('Zelda')
    expect(copy).not.toContain('Unenrolled')
  })

  it('serves the same names through the read API', () => {
    const { pub, cls } = vaultWithSecrets()
    expect(pub.repos.directory.students(cls.id)).toEqual([
      { id: expect.any(Number), name: 'Pri Abernathy' }
    ])
  })
})

describe('keeping the copy in step with the Vault', () => {
  const names = (ctx: ReturnType<typeof vaultWithSecrets>): string[] =>
    ctx.pub.repos.directory.students(ctx.cls.id).map((s) => s.name)

  it('is built when the Vault opens (the first sync), including after an upgrade', () => {
    const pub = makePublicEnv()
    const vdb = openVaultDatabase(':memory:')
    const repos = createVaultRepositories(vdb, () => undefined) // no events: like data from an older version
    const term = repos.terms.create({ name: 'T' })
    const cls = repos.classes.create({ termId: term.id, course: 'Bio', gradingMode: 'points' })
    repos.classes.enroll(cls.id, repos.students.create({ firstName: 'Ada', lastName: 'L' }).id)
    expect(pub.repos.directory.classes()).toEqual([])
    expect(createRosterMirror(repos, pub.repos.directory).sync()).toBe(true)
    expect(pub.repos.directory.students(cls.id).map((s) => s.name)).toEqual(['Ada L'])
    expect(createRosterMirror(repos, pub.repos.directory).sync()).toBe(false) // nothing new
  })

  it('follows an enrollment, a rename, an unenrollment and a deleted student', () => {
    const ctx = vaultWithSecrets()
    const { repos, cls, pri } = ctx
    const sam = repos.students.create({ firstName: 'Sam', lastName: 'Baker' })
    repos.classes.enroll(cls.id, sam.id)
    expect(names(ctx)).toEqual(['Pri Abernathy', 'Sam Baker'])
    repos.students.update(pri.id, { lastName: 'Abernathy-Cole' })
    expect(names(ctx)).toContain('Pri Abernathy-Cole')
    repos.classes.unenroll(cls.id, sam.id)
    expect(names(ctx)).toEqual(['Pri Abernathy-Cole'])
    repos.students.delete(pri.id)
    expect(names(ctx)).toEqual([])
  })

  it('follows a class being added, renamed, moved to another term and deleted', () => {
    const ctx = vaultWithSecrets()
    const { repos, pub, cls, term } = ctx
    const next = repos.terms.create({ name: 'Spring 2027' })
    const bio = repos.classes.create({ termId: next.id, course: 'BIO 200', gradingMode: 'points' })
    expect(pub.repos.directory.classes().map((c) => c.course)).toEqual(['PHIL 101', 'BIO 200'])
    repos.classes.update(cls.id, { course: 'PHIL 102' })
    expect(pub.repos.directory.classes()[0].course).toBe('PHIL 102')
    repos.classes.update(bio.id, { termId: term.id })
    expect(pub.repos.directory.classes().find((c) => c.id === bio.id)?.termName).toBe('Fall 2026')
    repos.classes.delete(cls.id)
    expect(pub.repos.directory.classes().map((c) => c.id)).toEqual([bio.id])
  })

  it('follows a term being renamed or made the current one', () => {
    const ctx = vaultWithSecrets()
    const { repos, pub, term } = ctx
    repos.terms.update(term.id, { name: 'Autumn 2026' })
    expect(pub.repos.directory.classes()[0].termName).toBe('Autumn 2026')
    const other = repos.terms.create({ name: 'Spring 2027', isCurrent: true })
    expect(other.isCurrent).toBe(true)
    expect(pub.repos.directory.classes()[0].currentTerm).toBe(false)
  })

  it('leaves the copy alone for changes that are not about a roster, so grading never touches it', () => {
    const ctx = vaultWithSecrets()
    ctx.pub.events.length = 0
    ctx.repos.grading.createAssignment({ classId: ctx.cls.id, title: 'HW 2', pointsPossible: 5 })
    ctx.repos.advising.createGoal({ studentId: ctx.pri.id, title: 'Raise grade' })
    expect(ctx.pub.events).toEqual([])
  })

  it('does one write for an import-sized change, not one per student', () => {
    const ctx = vaultWithSecrets()
    ctx.pub.events.length = 0
    ctx.repos.transaction(() => {
      for (let i = 0; i < 25; i++) {
        const s = ctx.repos.students.create({ firstName: `S${i}`, lastName: `L${i}` })
        ctx.repos.classes.enroll(ctx.cls.id, s.id)
      }
    })
    expect(names(ctx)).toHaveLength(26)
    // students.changed and enrollments.changed both fire after the commit; only the first finds work to do.
    expect(ctx.pub.events.filter((e) => e.name === 'directory.changed')).toHaveLength(1)
  })

  it('shows the same people the Vault lists for the class, in the same order', () => {
    const ctx = vaultWithSecrets()
    for (const n of ['Cleo Zane', 'Abe Young', 'Bea Xu']) {
      const [first, last] = n.split(' ')
      ctx.repos.classes.enroll(
        ctx.cls.id,
        ctx.repos.students.create({ firstName: first, lastName: last }).id
      )
    }
    expect(ctx.repos.classes.roster(ctx.cls.id).map((s) => s.lastName)).toEqual([
      'Abernathy',
      'Xu',
      'Young',
      'Zane'
    ])
    expect(names(ctx)).toEqual(['Pri Abernathy', 'Bea Xu', 'Abe Young', 'Cleo Zane'])
  })
})

describe('a failing copy never gets in the way', () => {
  it('does not throw, reports the error and leaves the teacher’s own save in place', () => {
    const pub = makePublicEnv()
    const vdb = openVaultDatabase(':memory:')
    const errors: unknown[] = []
    const broken = {
      ...directoryRepo(pub.db, () => undefined),
      replace: () => {
        throw new Error('disk is full')
      }
    }
    let mirror: ReturnType<typeof createRosterMirror> | null = null
    const repos = createVaultRepositories(vdb, (name) => mirror?.handle(name))
    mirror = createRosterMirror(repos, broken, (e) => errors.push(e))
    expect(mirror.sync()).toBe(false)
    const student = repos.students.create({ firstName: 'Ada', lastName: 'L' }) // fires students.changed
    expect(repos.students.get(student.id)).not.toBeNull()
    expect(errors.length).toBeGreaterThan(1)
  })

  it('keeps names out of the log line it writes by default', () => {
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    try {
      const pub = makePublicEnv()
      const vdb = openVaultDatabase(':memory:')
      const repos = createVaultRepositories(vdb, () => undefined)
      const term = repos.terms.create({ name: 'T' })
      const cls = repos.classes.create({ termId: term.id, course: 'Bio', gradingMode: 'points' })
      repos.classes.enroll(
        cls.id,
        repos.students.create({ firstName: 'Ada', lastName: 'Lovelace' }).id
      )
      const broken = {
        ...pub.repos.directory,
        replace: () => {
          throw new Error('boom')
        }
      }
      createRosterMirror(repos, broken).sync()
    } finally {
      console.error = original
    }
    expect(logged).toHaveLength(1)
    expect(JSON.stringify(logged)).not.toMatch(/Ada|Lovelace/)
  })

  it('takes a snapshot of nothing when there are no classes', () => {
    const repos = createVaultRepositories(openVaultDatabase(':memory:'), () => undefined)
    expect(rosterSnapshot(repos)).toEqual({ classes: [] })
  })
})
