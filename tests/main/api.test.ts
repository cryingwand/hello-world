import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { API_METHODS, type ApiContract } from '@shared/api'
import { CHANGE_NAMES } from '@shared/events'
import { createApi } from '../../src/main/api'
import { createBackupService } from '../../src/main/backupService'
import { openVaultDatabase } from '../../src/main/db/connection'
import { createFilesApi } from '../../src/main/filesApi'
import { createNotifier } from '../../src/main/notifier'
import { createFileGuard, createProtectedPaths } from '../../src/main/protected'
import { createProtectionService } from '../../src/main/protectionService'
import { createVaultRepositories } from '../../src/main/repos'
import { createLessonService } from '../../src/main/lessonService'
import { createQuizService } from '../../src/main/quizService'
import { createRosterService } from '../../src/main/rosterService'
import { createScoreService } from '../../src/main/scoreService'
import { createStageService } from '../../src/main/stage'
import { createVaultGate } from '../../src/main/vault/gate'
import { createVaultManager } from '../../src/main/vault/manager'
import { makePublicEnv, type TestEnv } from './helpers'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Session {
  repos: ReturnType<typeof createVaultRepositories>
  roster: ReturnType<typeof createRosterService>
  scores: ReturnType<typeof createScoreService>
  quizzes: ReturnType<typeof createQuizService>
  lessons: ReturnType<typeof createLessonService>
}

/** The whole API over a real vault manager in a temp folder, with cheap scrypt. */
function env(opts: { unlocked?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tos-api-'))
  dirs.push(dir)
  const pub = makePublicEnv()
  const vaultEvents: TestEnv['events'] = []
  const manager = createVaultManager<Session>({
    dir,
    openDb: openVaultDatabase,
    createSession: (db) => {
      const repos = createVaultRepositories(db, (name, detail) =>
        vaultEvents.push({ name, ...detail })
      )
      const roster = createRosterService(repos, {
        pickOpenFile: async () => null,
        pickSaveFile: async () => null
      })
      const scores = createScoreService(repos, roster.tokens, { pickSaveFile: async () => null })
      const quizzes = createQuizService(repos, { pickSaveFile: async () => null })
      const lessons = createLessonService(repos, { pickSaveFile: async () => null })
      return { repos, roster, scores, quizzes, lessons }
    },
    scrypt: { N: 1 << 4, r: 8, p: 1, keylen: 32 }
  })
  const stage = createStageService({
    screen: {
      getAllDisplays: () => [{ internal: true }],
      on: () => undefined,
      removeListener: () => undefined
    },
    notifier: createNotifier({ show: () => undefined }),
    lockVault: () => undefined,
    guard: createFileGuard({
      paths: createProtectedPaths({ folders: () => [] }),
      allowProtected: () => false,
      externalDisplays: () => 0
    }),
    offerEnabled: () => true,
    sendToLauncher: () => undefined,
    openWindow: () => ({ showView: () => undefined, close: () => undefined })
  })
  const gate = createVaultGate({
    manager,
    presenting: () => stage.isActive(),
    externalDisplays: () => 0,
    confirmExternalDisplay: async () => true
  })
  const api = createApi({
    vault: {
      repos: () => manager.session().repos,
      roster: () => manager.session().roster,
      scores: () => manager.session().scores,
      quizzes: () => manager.session().quizzes,
      lessons: () => manager.session().lessons
    },
    publicRepos: pub.repos,
    protection: createProtectionService({
      repo: pub.repos.protection,
      paths: createProtectedPaths({ folders: () => pub.repos.protection.list() }),
      chooseFolder: async () => null
    }),
    backups: createBackupService({
      dir: join(dir, 'backups'),
      publicDb: () => pub.db,
      vault: { open: () => null, dbPath: manager.paths.db },
      extraDir: () => null
    }),
    gate,
    stage,
    files: createFilesApi({
      settings: () => pub.repos.settings.get(),
      exec: async () => ({ stdout: '', stderr: '' }),
      home: '/Users/t',
      isMac: () => true,
      isTrusted: () => true,
      launcher: { snapLeft: async () => null, restore: () => undefined },
      thumbnail: async () => null,
      reveal: () => undefined,
      pickFile: async () => null,
      guard: createFileGuard({
        paths: createProtectedPaths({ folders: () => [] }),
        allowProtected: () => false,
        externalDisplays: () => 0
      })
    }),
    env: {
      dataDir: '/data',
      dbPath: '/data/data.sqlite',
      vaultPath: '/data/vault/vault.sqlite',
      backupDir: '/data/backups',
      chooseFolder: async () => null,
      openAccessibilitySettings: async () => undefined,
      openVaultWindow: () => undefined,
      version: '0.0.0',
      platform: 'test'
    }
  })
  const ready = opts.unlocked === false ? Promise.resolve() : manager.setup('a long passcode', {})
  return { api, manager, pub, vaultEvents, ready }
}

describe('api wiring', () => {
  it('implements exactly the methods the preload bridge will expose', () => {
    const { api } = env({ unlocked: false })
    for (const ns of Object.keys(API_METHODS) as (keyof ApiContract)[]) {
      expect(Object.keys(api[ns]).sort(), ns).toEqual([...API_METHODS[ns]].sort())
    }
    expect(Object.keys(api).sort()).toEqual(Object.keys(API_METHODS).sort())
  })

  it('routes calls through to the repositories once the vault is unlocked', async () => {
    const { api, ready } = env()
    await ready
    const term = await api.terms.create({ name: 'T' })
    const cls = await api.classes.create({
      termId: term.id,
      course: 'Bio',
      gradingMode: 'weighted'
    })
    expect((await api.classes.list())[0].id).toBe(cls.id)
    expect((await api.system.info()).platform).toBe('test')
  })

  it('serves advising through the same vault session', async () => {
    const { api, ready } = env()
    await ready
    const ada = await api.students.create({ firstName: 'Ada', lastName: 'L', tags: ['advisee'] })
    const meeting = await api.advising.createMeeting({ studentId: ada.id, metOn: '2026-10-01' })
    expect((await api.advising.meetings(ada.id)).map((m) => m.id)).toEqual([meeting.id])
    expect((await api.advising.advisees())[0].student.id).toBe(ada.id)
  })

  it('serves the question bank and quizzes through the same vault session', async () => {
    const { api, ready } = env()
    await ready
    const q = await api.questions.create({ kind: 'short-answer', prompt: 'Why?' })
    const quiz = await api.quizzes.create({ title: 'Quiz 1' })
    const withQ = await api.quizzes.addQuestions(quiz.id, [q.id])
    expect(withQ.entries.map((e) => e.questionId)).toEqual([q.id])
    expect((await api.quizzes.list())[0]).toMatchObject({ questionCount: 1, totalPoints: 1 })
    await expect(Promise.resolve().then(() => api.questions.delete(q.id))).rejects.toThrow(
      /in 1 quiz/
    )
  })

  it('serves the planner through the same vault session', async () => {
    const { api, ready } = env()
    await ready
    const quiz = await api.quizzes.create({ title: 'Quiz 1' })
    const unit = await api.units.create({ title: 'Ethics', course: 'PHIL 101' })
    const lesson = await api.lessons.create({ unitId: unit.id, title: 'Day 1', date: '2999-01-02' })
    await api.lessons.linkQuiz(lesson.id, quiz.id)
    expect((await api.units.get(unit.id))?.lessons[0].quizzes.map((q) => q.id)).toEqual([quiz.id])
    expect((await api.units.list())[0]).toMatchObject({ lessonCount: 1 })
    expect((await api.units.upcoming())[0].lesson.id).toBe(lesson.id)
  })

  it('refuses every vault method while the vault is locked', async () => {
    const { api, manager } = env({ unlocked: false })
    expect(manager.isUnlocked()).toBe(false)
    await expect(Promise.resolve().then(() => api.students.list())).rejects.toThrow(/locked/)
    await expect(Promise.resolve().then(() => api.grading.scores(1))).rejects.toThrow(/locked/)
    await expect(Promise.resolve().then(() => api.advising.advisees())).rejects.toThrow(/locked/)
    await expect(Promise.resolve().then(() => api.questions.list())).rejects.toThrow(/locked/)
    await expect(Promise.resolve().then(() => api.quizzes.list())).rejects.toThrow(/locked/)
    await expect(Promise.resolve().then(() => api.units.list())).rejects.toThrow(/locked/)
    await expect(Promise.resolve().then(() => api.fileLinks.list('class', 1))).rejects.toThrow(
      /locked/
    )
    // Settings are public and keep working.
    expect((await api.settings.get()).teachingFolders).toEqual([])
  })

  it('only ever emits declared change names', async () => {
    const { api, pub, vaultEvents, ready } = env()
    await ready
    const t = await api.terms.create({ name: 'T' })
    await api.classes.create({ termId: t.id, course: 'C', gradingMode: 'points' })
    await api.settings.update({ backupFolder: '/x' })
    for (const ev of [...vaultEvents, ...pub.events]) expect(CHANGE_NAMES).toContain(ev.name)
    expect(pub.events.map((e) => e.name)).toEqual(['settings.changed'])
  })
})
