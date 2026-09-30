import { describe, expect, it } from 'vitest'
import { makeEnv, seedClass } from './helpers'

describe('terms', () => {
  it('creates, lists newest first, and keeps a single current term', () => {
    const { repos } = makeEnv()
    repos.terms.create({ name: 'Fall 2025', startDate: '2025-09-01', isCurrent: true })
    const b = repos.terms.create({ name: 'Fall 2026', startDate: '2026-09-01', isCurrent: true })
    expect(repos.terms.list().map((t) => t.name)).toEqual(['Fall 2026', 'Fall 2025'])
    expect(repos.terms.list().filter((t) => t.isCurrent)).toEqual([b])
  })

  it('validates names and dates', () => {
    const { repos } = makeEnv()
    expect(() => repos.terms.create({ name: '  ' })).toThrow(/required/)
    expect(() => repos.terms.create({ name: 'x', startDate: 'soon' })).toThrow(/date/)
    expect(() =>
      repos.terms.create({ name: 'x', startDate: '2026-09-02', endDate: '2026-09-01' })
    ).toThrow(/before/)
  })

  it('refuses to delete a term that still has classes', () => {
    const env = makeEnv()
    const { term } = seedClass(env)
    expect(() => env.repos.terms.delete(term.id)).toThrow(/still has 1 class/)
  })
})

describe('students', () => {
  it('normalises fields and tags', () => {
    const { repos } = makeEnv()
    const s = repos.students.create({
      firstName: ' Ada ',
      lastName: 'Lovelace',
      tags: ['Advisee', 'advisee ', 'IEP']
    })
    expect(s).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', tags: ['advisee', 'iep'] })
  })

  it('requires at least one name', () => {
    const { repos } = makeEnv()
    expect(() => repos.students.create({ firstName: '', lastName: ' ' })).toThrow(
      /first or last name/
    )
    expect(repos.students.create({ firstName: 'Cher', lastName: '' }).firstName).toBe('Cher')
  })

  it('searches case-insensitively, treats % and _ literally, filters by tag and class', () => {
    const env = makeEnv()
    const { repos } = env
    const a = repos.students.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@x.org',
      tags: ['advisee']
    })
    repos.students.create({ firstName: 'Alan', lastName: 'Turing' })
    repos.students.create({ firstName: '100%', lastName: 'Real' })
    expect(repos.students.list({ search: 'LOVE' })).toHaveLength(1)
    expect(repos.students.list({ search: 'ada@x' })).toHaveLength(1)
    expect(repos.students.list({ search: '%' }).map((s) => s.lastName)).toEqual(['Real'])
    expect(repos.students.list({ tag: 'Advisee' })).toEqual([a])
    const term = repos.terms.create({ name: 'T' })
    const cls = repos.classes.create({ termId: term.id, course: 'C', gradingMode: 'points' })
    repos.classes.enroll(cls.id, a.id)
    expect(repos.students.list({ classId: cls.id })).toEqual([a])
  })

  it('sorts by last then first name, ignoring case', () => {
    const { repos } = makeEnv()
    repos.students.create({ firstName: 'B', lastName: 'smith' })
    repos.students.create({ firstName: 'A', lastName: 'Smith' })
    repos.students.create({ firstName: 'Z', lastName: 'Adams' })
    expect(repos.students.list().map((s) => `${s.lastName},${s.firstName}`)).toEqual([
      'Adams,Z',
      'Smith,A',
      'smith,B'
    ])
  })

  it('updates partially and emits a change', () => {
    const { repos, events } = makeEnv()
    const s = repos.students.create({ firstName: 'Ada', lastName: 'L', notes: 'keep' })
    events.length = 0
    const u = repos.students.update(s.id, { lastName: 'Lovelace' })
    expect(u).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', notes: 'keep' })
    expect(events).toEqual([{ name: 'students.changed' }])
  })

  it('deleting a student removes enrollments, scores and file links', () => {
    const env = makeEnv()
    const { cls, students } = seedClass(env, 2)
    const a = env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'Quiz',
      pointsPossible: 10
    })
    env.repos.grading.setScore({
      assignmentId: a.id,
      studentId: students[0].id,
      points: 9,
      status: null
    })
    env.repos.fileLinks.add({ path: '/tmp/x.pdf', recordType: 'student', recordId: students[0].id })
    env.repos.students.delete(students[0].id)
    expect(env.repos.classes.roster(cls.id)).toHaveLength(1)
    expect(env.repos.grading.scores(cls.id)).toHaveLength(0)
    expect(env.repos.fileLinks.list('student', students[0].id)).toHaveLength(0)
  })
})

describe('classes and enrollments', () => {
  it('validates grading mode and term', () => {
    const { repos } = makeEnv()
    const t = repos.terms.create({ name: 'T' })
    expect(() =>
      repos.classes.create({ termId: t.id, course: 'C', gradingMode: 'letters' as never })
    ).toThrow(/Grading mode/)
    expect(() => repos.classes.create({ termId: 999, course: 'C', gradingMode: 'points' })).toThrow(
      /term/
    )
    expect(() => repos.classes.create({ termId: t.id, course: '', gradingMode: 'points' })).toThrow(
      /required/
    )
  })

  it('lists summaries with term name and student count', () => {
    const env = makeEnv()
    seedClass(env, 4)
    expect(env.repos.classes.list()[0]).toMatchObject({
      course: 'History',
      termName: 'Fall 2026',
      studentCount: 4
    })
  })

  it('enrolling twice is harmless and the roster is ordered', () => {
    const env = makeEnv()
    const { cls, students } = seedClass(env, 3)
    env.repos.classes.enroll(cls.id, students[0].id)
    expect(env.repos.classes.roster(cls.id).map((s) => s.lastName)).toEqual([
      'Last0',
      'Last1',
      'Last2'
    ])
  })

  it("unenrolling removes that student's scores in that class only", () => {
    const env = makeEnv()
    const { cls, students, term } = seedClass(env, 2)
    const other = env.repos.classes.create({
      termId: term.id,
      course: 'Other',
      gradingMode: 'points'
    })
    env.repos.classes.enroll(other.id, students[0].id)
    const a1 = env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'A',
      pointsPossible: 10
    })
    const a2 = env.repos.grading.createAssignment({
      classId: other.id,
      title: 'B',
      pointsPossible: 10
    })
    env.repos.grading.setScore({
      assignmentId: a1.id,
      studentId: students[0].id,
      points: 5,
      status: null
    })
    env.repos.grading.setScore({
      assignmentId: a2.id,
      studentId: students[0].id,
      points: 7,
      status: null
    })
    env.repos.classes.unenroll(cls.id, students[0].id)
    expect(env.repos.grading.scores(cls.id)).toHaveLength(0)
    expect(env.repos.grading.scores(other.id)).toHaveLength(1)
  })

  it('deleting a class cascades to its gradebook but keeps the students', () => {
    const env = makeEnv()
    const { cls, students } = seedClass(env)
    const cat = env.repos.grading.createCategory({ classId: cls.id, name: 'Tests', weight: 50 })
    env.repos.grading.createAssignment({
      classId: cls.id,
      categoryId: cat.id,
      title: 'T1',
      pointsPossible: 100
    })
    env.repos.classes.delete(cls.id)
    expect(env.repos.classes.list()).toHaveLength(0)
    expect(env.db.prepare('SELECT COUNT(*) n FROM assignments').get()).toEqual({ n: 0 })
    expect(env.db.prepare('SELECT COUNT(*) n FROM grade_categories').get()).toEqual({ n: 0 })
    expect(env.repos.students.list()).toHaveLength(students.length)
  })

  it('finds the classes a student is in', () => {
    const env = makeEnv()
    const { students } = seedClass(env, 1)
    expect(env.repos.classes.forStudent(students[0].id).map((c) => c.course)).toEqual(['History'])
  })

  it('emits scoped events', () => {
    const env = makeEnv()
    const { cls, students } = seedClass(env, 1)
    env.repos.classes.unenroll(cls.id, students[0].id)
    expect(env.events).toContainEqual({ name: 'enrollments.changed', classId: cls.id })
  })
})

describe('gradebook data', () => {
  it('keeps categories ordered and lets assignments outlive a deleted category', () => {
    const env = makeEnv()
    const { cls } = seedClass(env)
    const c1 = env.repos.grading.createCategory({ classId: cls.id, name: 'Homework', weight: 30 })
    const c2 = env.repos.grading.createCategory({ classId: cls.id, name: 'Tests', weight: 70 })
    expect(env.repos.grading.categories(cls.id).map((c) => c.name)).toEqual(['Homework', 'Tests'])
    const a = env.repos.grading.createAssignment({
      classId: cls.id,
      categoryId: c2.id,
      title: 'T1',
      pointsPossible: 50
    })
    env.repos.grading.deleteCategory(c2.id)
    expect(env.repos.grading.assignments(cls.id)[0]).toMatchObject({ id: a.id, categoryId: null })
    expect(env.repos.grading.categories(cls.id)).toEqual([c1])
  })

  it('rejects a category from another class and negative weights or points', () => {
    const env = makeEnv()
    const { cls, term } = seedClass(env)
    const other = env.repos.classes.create({
      termId: term.id,
      course: 'Other',
      gradingMode: 'weighted'
    })
    const foreign = env.repos.grading.createCategory({ classId: other.id, name: 'X', weight: 10 })
    expect(() =>
      env.repos.grading.createAssignment({
        classId: cls.id,
        categoryId: foreign.id,
        title: 'A',
        pointsPossible: 1
      })
    ).toThrow(/different class/)
    expect(() =>
      env.repos.grading.createCategory({ classId: cls.id, name: 'Bad', weight: -1 })
    ).toThrow(/at least 0/)
    expect(() =>
      env.repos.grading.createAssignment({ classId: cls.id, title: 'A', pointsPossible: -5 })
    ).toThrow(/at least 0/)
  })

  it('upserts scores, stores flags, and clears an empty score', () => {
    const env = makeEnv()
    const { cls, students } = seedClass(env)
    const a = env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'Quiz',
      pointsPossible: 10
    })
    const sid = students[0].id
    const first = env.repos.grading.setScore({
      assignmentId: a.id,
      studentId: sid,
      points: 7,
      status: null
    })
    const second = env.repos.grading.setScore({
      assignmentId: a.id,
      studentId: sid,
      points: 8.5,
      status: 'late',
      comment: 'turned in Tuesday'
    })
    expect(second).toMatchObject({
      id: first!.id,
      points: 8.5,
      status: 'late',
      comment: 'turned in Tuesday'
    })
    expect(env.repos.grading.scores(cls.id)).toHaveLength(1)
    expect(
      env.repos.grading.setScore({ assignmentId: a.id, studentId: sid, points: null, status: null })
    ).toBeNull()
    expect(env.repos.grading.scores(cls.id)).toHaveLength(0)
  })

  it('can store a missing flag with no points', () => {
    const env = makeEnv()
    const { cls, students } = seedClass(env)
    const a = env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'Quiz',
      pointsPossible: 10
    })
    const s = env.repos.grading.setScore({
      assignmentId: a.id,
      studentId: students[0].id,
      points: null,
      status: 'missing'
    })
    expect(s).toMatchObject({ points: null, status: 'missing' })
  })

  it('rejects scores for students who are not enrolled, and bad values', () => {
    const env = makeEnv()
    const { cls } = seedClass(env)
    const stranger = env.repos.students.create({ firstName: 'No', lastName: 'Class' })
    const a = env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'Quiz',
      pointsPossible: 10
    })
    expect(() =>
      env.repos.grading.setScore({
        assignmentId: a.id,
        studentId: stranger.id,
        points: 1,
        status: null
      })
    ).toThrow(/not enrolled/)
    const enrolled = env.repos.classes.roster(cls.id)[0]
    expect(() =>
      env.repos.grading.setScore({
        assignmentId: a.id,
        studentId: enrolled.id,
        points: -1,
        status: null
      })
    ).toThrow(/at least 0/)
    expect(() =>
      env.repos.grading.setScore({
        assignmentId: a.id,
        studentId: enrolled.id,
        points: 1,
        status: 'lost' as never
      })
    ).toThrow(/Status/)
    expect(() =>
      env.repos.grading.setScore({
        assignmentId: a.id,
        studentId: enrolled.id,
        points: Number.NaN,
        status: null
      })
    ).toThrow(/number/)
  })

  it('setScores is all-or-nothing and emits once per class', () => {
    const env = makeEnv()
    const { cls, students } = seedClass(env, 2)
    const a = env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'Quiz',
      pointsPossible: 10
    })
    env.events.length = 0
    expect(() =>
      env.repos.grading.setScores([
        { assignmentId: a.id, studentId: students[0].id, points: 5, status: null },
        { assignmentId: a.id, studentId: 99999, points: 5, status: null }
      ])
    ).toThrow()
    expect(env.repos.grading.scores(cls.id)).toHaveLength(0)
    expect(env.events).toHaveLength(0)

    env.repos.grading.setScores(
      students.map((s) => ({ assignmentId: a.id, studentId: s.id, points: 9, status: null }))
    )
    expect(env.repos.grading.scores(cls.id)).toHaveLength(2)
    expect(env.events).toEqual([{ name: 'scores.changed', classId: cls.id }])
  })

  it('tracks the app that created an assignment', () => {
    const env = makeEnv()
    const { cls } = seedClass(env)
    const a = env.repos.grading.createAssignment({
      classId: cls.id,
      title: 'Unit 1 Quiz',
      pointsPossible: 20,
      sourceApp: 'quiz',
      sourceId: 'q-7'
    })
    expect(a).toMatchObject({ sourceApp: 'quiz', sourceId: 'q-7' })
  })
})

describe('file links', () => {
  it('links a file once per record and requires an absolute path and a real record', () => {
    const env = makeEnv()
    const { cls } = seedClass(env)
    const a = env.repos.fileLinks.add({
      path: '/Users/t/plan.docx',
      recordType: 'class',
      recordId: cls.id
    })
    const b = env.repos.fileLinks.add({
      path: '/Users/t/plan.docx',
      recordType: 'class',
      recordId: cls.id
    })
    expect(b.id).toBe(a.id)
    expect(env.repos.fileLinks.list('class', cls.id)).toHaveLength(1)
    expect(() =>
      env.repos.fileLinks.add({ path: 'plan.docx', recordType: 'class', recordId: cls.id })
    ).toThrow(/absolute/)
    expect(() =>
      env.repos.fileLinks.add({ path: '/x', recordType: 'class', recordId: 9999 })
    ).toThrow(/no longer exists/)
  })
})

describe('settings', () => {
  it('returns defaults, merges updates, and normalises folders', () => {
    const { repos, events } = makeEnv()
    expect(repos.settings.get()).toEqual({
      teachingFolders: [],
      backupFolder: null,
      presentation: { offerOnExternalDisplay: true }
    })
    const s = repos.settings.update({
      teachingFolders: ['/Users/t/Courses/', '/Users/t/Courses', '/Users/t/Lessons']
    })
    expect(s.teachingFolders).toEqual(['/Users/t/Courses', '/Users/t/Lessons'])
    expect(repos.settings.update({ backupFolder: '/Volumes/USB' }).teachingFolders).toHaveLength(2)
    expect(
      repos.settings.update({ presentation: { offerOnExternalDisplay: false } }).presentation
        .offerOnExternalDisplay
    ).toBe(false)
    expect(repos.settings.update({ backupFolder: null }).backupFolder).toBeNull()
    expect(events.every((e) => e.name === 'settings.changed')).toBe(true)
  })

  it('rejects relative folders', () => {
    const { repos } = makeEnv()
    expect(() => repos.settings.update({ teachingFolders: ['Courses'] })).toThrow(/absolute/)
    expect(() => repos.settings.update({ backupFolder: 'backups' })).toThrow(/absolute/)
  })
})
