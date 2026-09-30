import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProtectedPaths } from '../../src/main/protected'
import { createProtectionService } from '../../src/main/protectionService'
import { makePublicEnv } from './helpers'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('protection repository', () => {
  it('starts empty and stores folders in the public database', () => {
    const { repos } = makePublicEnv()
    expect(repos.protection.list()).toEqual([])
    repos.protection.add('/Users/t/Exams')
    expect(repos.protection.list()).toEqual(['/Users/t/Exams'])
  })

  it('never appears in the settings the everyday windows can read', () => {
    const { repos } = makePublicEnv()
    repos.protection.add('/Users/t/Secret Exams')
    const settings = repos.settings.get()
    expect(JSON.stringify(settings)).not.toContain('Secret')
    expect(Object.keys(settings).sort()).toEqual([
      'backupFolder',
      'presentation',
      'teachingFolders'
    ])
    expect(JSON.stringify(repos.settings.update({ backupFolder: '/x' }))).not.toContain('Secret')
  })

  it('settings updates cannot touch the protected list', () => {
    const { repos } = makePublicEnv()
    repos.protection.add('/Users/t/Exams')
    repos.settings.update({ protectedFolders: [] } as never)
    expect(repos.protection.list()).toEqual(['/Users/t/Exams'])
  })

  it('ignores a repeated folder, trailing slashes and different spellings of the same name', () => {
    const { repos } = makePublicEnv()
    repos.protection.add('/Users/t/Exams')
    repos.protection.add('/Users/t/Exams/')
    repos.protection.add('/users/T/EXAMS')
    expect(repos.protection.list()).toEqual(['/Users/t/Exams'])
  })

  it('refuses a folder already covered by a protected parent', () => {
    const { repos } = makePublicEnv()
    repos.protection.add('/Users/t/Exams')
    expect(() => repos.protection.add('/Users/t/Exams/Unit 1')).toThrow(/already protected/)
    // A sibling that merely shares a prefix is a different folder.
    repos.protection.add('/Users/t/Exams-old')
    expect(repos.protection.list()).toHaveLength(2)
  })

  it('folds existing children into a new parent', () => {
    const { repos } = makePublicEnv()
    repos.protection.add('/Users/t/Exams/Unit 1')
    repos.protection.add('/Users/t/Exams/Unit 2')
    repos.protection.add('/Users/t/Quizzes')
    repos.protection.add('/Users/t/Exams')
    expect(repos.protection.list().sort()).toEqual(['/Users/t/Exams', '/Users/t/Quizzes'])
  })

  it('rejects relative paths, the disk root and non-text', () => {
    const { repos } = makePublicEnv()
    expect(() => repos.protection.add('Exams')).toThrow(/on this Mac/)
    expect(() => repos.protection.add('/')).toThrow(/not the whole disk/)
    expect(() => repos.protection.add(42)).toThrow()
    expect(() => repos.protection.add('')).toThrow()
    expect(() => repos.protection.add('/a\0b')).toThrow()
    expect(repos.protection.list()).toEqual([])
  })

  it('removes a folder and announces only protection changes', () => {
    const { repos, events } = makePublicEnv()
    repos.protection.add('/Users/t/Exams')
    repos.protection.remove('/Users/t/Exams')
    repos.protection.remove('/Users/t/Exams') // already gone: no change, no event
    expect(repos.protection.list()).toEqual([])
    expect(events.map((e) => e.name)).toEqual(['protection.changed', 'protection.changed'])
  })

  it('survives a corrupt stored value', () => {
    const { db, repos } = makePublicEnv()
    db.prepare("INSERT INTO settings (key, value) VALUES ('protectedFolders', 'not json')").run()
    expect(repos.protection.list()).toEqual([])
    db.prepare("UPDATE settings SET value = '{\"a\":1}' WHERE key = 'protectedFolders'").run()
    expect(repos.protection.list()).toEqual([])
  })
})

describe('protection service', () => {
  function setup(choose: () => string | null = () => null) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'tos-psvc-')))
    dirs.push(root)
    mkdirSync(join(root, 'Exams', 'Unit 10'), { recursive: true })
    mkdirSync(join(root, 'Exams', 'Unit 2'))
    mkdirSync(join(root, 'Lessons'))
    writeFileSync(join(root, 'Exams', 'Final.pdf'), '%PDF')
    writeFileSync(join(root, 'Exams', '.DS_Store'), 'x')
    writeFileSync(join(root, 'Exams', 'Unit 2', 'Quiz.docx'), 'x')
    writeFileSync(join(root, 'Lessons', 'Plan.pdf'), '%PDF')
    const env = makePublicEnv()
    const service = createProtectionService({
      repo: env.repos.protection,
      paths: createProtectedPaths({ folders: () => env.repos.protection.list(), foldCase: false }),
      chooseFolder: async () => choose()
    })
    return { root, env, service }
  }

  it('adds a chosen folder, reports whether it exists, and does nothing on cancel', async () => {
    let pick: string | null = null
    const { root, service } = setup(() => pick)
    expect(await service.chooseAndAdd()).toEqual([])
    pick = join(root, 'Exams')
    expect(await service.chooseAndAdd()).toEqual([{ path: join(root, 'Exams'), exists: true }])
  })

  it('refuses a chosen path that is not a folder', async () => {
    const { root, service } = setup(() => null)
    const file = join(root, 'Lessons', 'Plan.pdf')
    const s = createProtectionService({
      repo: makePublicEnv().repos.protection,
      paths: createProtectedPaths({ folders: () => [] }),
      chooseFolder: async () => file
    })
    await expect(s.chooseAndAdd()).rejects.toThrow(/not a folder/)
    expect(await service.folders()).toEqual([])
  })

  it('lists a folder that is gone as not existing, but keeps it', async () => {
    const { root, env, service } = setup()
    env.repos.protection.add(join(root, 'Unplugged'))
    expect(await service.folders()).toEqual([{ path: join(root, 'Unplugged'), exists: false }])
  })

  it('browses one level: folders first, natural order, no hidden files, no way up from the top', async () => {
    const { root, env, service } = setup()
    env.repos.protection.add(join(root, 'Exams'))
    const top = await service.browse(join(root, 'Exams'))
    expect(top.parent).toBeNull()
    expect(top.entries.map((e) => `${e.isDir ? 'd' : 'f'}:${e.name}`)).toEqual([
      'd:Unit 2',
      'd:Unit 10',
      'f:Final.pdf'
    ])
    expect(top.entries.find((e) => e.name === 'Final.pdf')).toMatchObject({
      kind: 'pdf',
      path: join(root, 'Exams', 'Final.pdf')
    })
    const sub = await service.browse(join(root, 'Exams', 'Unit 2'))
    expect(sub.parent).toBe(join(root, 'Exams'))
    expect(sub.entries.map((e) => e.name)).toEqual(['Quiz.docx'])
  })

  it('refuses to list anything outside a protected folder', async () => {
    const { root, env, service } = setup()
    env.repos.protection.add(join(root, 'Exams'))
    for (const dir of [
      join(root, 'Lessons'),
      root,
      '/',
      '/etc',
      join(root, 'Exams', '..', 'Lessons'),
      'relative/dir',
      join(root, 'Exams', 'Final.pdf'), // a file, not a folder
      ''
    ]) {
      await expect(service.browse(dir), dir).rejects.toThrow(
        /not one of your protected folders|not a valid folder/
      )
    }
    await expect(service.browse(undefined as never)).rejects.toThrow(/not a valid folder/)
  })

  it('treats a link inside a protected folder as inside it, and its target by its real name as not', async () => {
    const { root, env, service } = setup()
    env.repos.protection.add(join(root, 'Exams'))
    symlinkSync(join(root, 'Lessons'), join(root, 'Exams', 'out'))
    // Lexically inside, so it is treated as protected: listing it is allowed but stays confined to it.
    const listing = await service.browse(join(root, 'Exams', 'out'))
    expect(listing.entries.map((e) => e.name)).toEqual(['Plan.pdf'])
    // The same folder reached by its real name is not protected.
    await expect(service.browse(join(root, 'Lessons'))).rejects.toThrow(/not one of your protected/)
  })

  it('removes a folder', async () => {
    const { root, env, service } = setup()
    env.repos.protection.add(join(root, 'Exams'))
    expect(await service.remove(join(root, 'Exams'))).toEqual([])
    await expect(service.browse(join(root, 'Exams'))).rejects.toThrow()
  })
})
