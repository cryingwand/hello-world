import { describe, expect, it } from 'vitest'
import { API_METHODS, type ApiContract } from '@shared/api'
import { CHANGE_NAMES } from '@shared/events'
import { createApi } from '../../src/main/api'
import { createFilesApi } from '../../src/main/filesApi'
import { createNotifier } from '../../src/main/notifier'
import { createPresentationService } from '../../src/main/presentation'
import { createRosterService } from '../../src/main/rosterService'
import { createScoreService } from '../../src/main/scoreService'
import { makeEnv } from './helpers'

const env = (): { api: ApiContract; e: ReturnType<typeof makeEnv> } => {
  const e = makeEnv()
  const roster = createRosterService(e.repos, {
    pickOpenFile: async () => null,
    pickSaveFile: async () => null
  })
  const api = createApi(
    e.db,
    e.repos,
    roster,
    createScoreService(e.repos, roster.tokens, { pickSaveFile: async () => null }),
    createPresentationService({
      screen: {
        getAllDisplays: () => [{ internal: true }],
        on: () => undefined,
        removeListener: () => undefined
      },
      notifier: createNotifier({ show: () => undefined }),
      offerEnabled: () => true,
      send: () => undefined
    }),
    createFilesApi({
      settings: () => e.repos.settings.get(),
      exec: async () => ({ stdout: '', stderr: '' }),
      home: '/Users/t',
      isMac: () => true,
      isTrusted: () => true,
      launcher: { snapLeft: async () => null, restore: () => undefined },
      thumbnail: async () => null,
      reveal: () => undefined,
      pickFile: async () => null
    }),
    {
      dataDir: '/data',
      dbPath: '/data/data.sqlite',
      backupDir: '/data/backups',
      chooseFolder: async () => null,
      openAccessibilitySettings: async () => undefined,
      version: '0.0.0',
      platform: 'test'
    }
  )
  return { api, e }
}

describe('api wiring', () => {
  it('implements exactly the methods the preload bridge will expose', () => {
    const { api } = env()
    for (const ns of Object.keys(API_METHODS) as (keyof ApiContract)[]) {
      expect(Object.keys(api[ns]).sort(), ns).toEqual([...API_METHODS[ns]].sort())
    }
    expect(Object.keys(api).sort()).toEqual(Object.keys(API_METHODS).sort())
  })

  it('routes calls through to the repositories', async () => {
    const { api } = env()
    const term = await api.terms.create({ name: 'T' })
    const cls = await api.classes.create({
      termId: term.id,
      course: 'Bio',
      gradingMode: 'weighted'
    })
    expect((await api.classes.list())[0].id).toBe(cls.id)
    expect((await api.system.info()).platform).toBe('test')
  })

  it('only ever emits declared change names', () => {
    const { e } = env()
    const t = e.repos.terms.create({ name: 'T' })
    e.repos.classes.create({ termId: t.id, course: 'C', gradingMode: 'points' })
    e.repos.settings.update({ backupFolder: '/x' })
    for (const ev of e.events) expect(CHANGE_NAMES).toContain(ev.name)
  })
})
