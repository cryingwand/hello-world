import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROTECTED_DISPLAY_MESSAGE,
  PROTECTED_MESSAGE,
  createFileGuard,
  createProtectedPaths
} from '../../src/main/protected'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A temp tree: <root>/Exams (protected), <root>/Exams-old, <root>/Lessons, with files in each. */
function tree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tos-prot-')))
  dirs.push(root)
  for (const d of ['Exams/Unit 1', 'Exams-old', 'Lessons'])
    mkdirSync(join(root, d), { recursive: true })
  const f = (p: string): string => {
    writeFileSync(join(root, p), 'x')
    return join(root, p)
  }
  return {
    root,
    exam: f('Exams/Unit 1/Final.pdf'),
    top: f('Exams/Key.docx'),
    sibling: f('Exams-old/Notes.pdf'),
    lesson: f('Lessons/Plan.pdf'),
    protect: (...names: string[]) =>
      createProtectedPaths({ folders: () => names.map((n) => join(root, n)), foldCase: false })
  }
}

describe('protected paths', () => {
  it('protects files at any depth, the folder itself, and not their neighbours', async () => {
    const t = tree()
    const p = t.protect('Exams')
    expect(await p.isProtected(t.exam)).toBe(true)
    expect(await p.isProtected(t.top)).toBe(true)
    expect(await p.isProtected(join(t.root, 'Exams'))).toBe(true)
    expect(await p.isProtected(t.lesson)).toBe(false)
  })

  it('matches whole path segments: a sibling that shares a prefix is not inside', async () => {
    const t = tree()
    expect(await t.protect('Exams').isProtected(t.sibling)).toBe(false)
  })

  it('resolves .. before comparing', async () => {
    const t = tree()
    const p = t.protect('Exams')
    expect(await p.isProtected(join(t.root, 'Lessons', '..', 'Exams', 'Key.docx'))).toBe(true)
    expect(await p.isProtected(join(t.root, 'Exams', '..', 'Lessons', 'Plan.pdf'))).toBe(false)
  })

  it('follows a symlink from outside into the folder', async () => {
    const t = tree()
    const link = join(t.root, 'Lessons', 'shortcut.pdf')
    symlinkSync(t.exam, link)
    const dirLink = join(t.root, 'Lessons', 'exams-link')
    symlinkSync(join(t.root, 'Exams'), dirLink)
    const p = t.protect('Exams')
    expect(await p.isProtected(link)).toBe(true)
    expect(await p.isProtected(join(dirLink, 'Key.docx'))).toBe(true)
    // The same through the snapshot's strong check.
    expect(await (await p.snapshot()).has(link)).toBe(true)
  })

  it('protects a file reached through a symlinked protected folder', async () => {
    const t = tree()
    const alias = join(t.root, 'Lessons', 'my-exams') // the folder is listed by this name
    symlinkSync(join(t.root, 'Exams'), alias)
    const p = createProtectedPaths({ folders: () => [alias], foldCase: false })
    expect(await p.isProtected(t.exam)).toBe(true) // the real location
    expect(await p.isProtected(join(alias, 'Key.docx'))).toBe(true) // the listed name
    expect(await p.isProtected(t.lesson)).toBe(false)
  })

  it('a path as written inside the folder stays protected even if a link there points elsewhere', async () => {
    const t = tree()
    const out = join(t.root, 'Exams', 'decoy.pdf')
    symlinkSync(t.lesson, out)
    expect(await t.protect('Exams').isProtected(out)).toBe(true)
  })

  it('protects files that do not exist yet, by where they would be', async () => {
    const t = tree()
    const p = t.protect('Exams')
    expect(await p.isProtected(join(t.root, 'Exams', 'New', 'Draft.docx'))).toBe(true)
    expect(await p.isProtected(join(t.root, 'Lessons', 'New', 'Draft.docx'))).toBe(false)
  })

  it('ignores case and Unicode form where the disk does (macOS)', async () => {
    const t = tree()
    const p = createProtectedPaths({ folders: () => [join(t.root, 'Exams')], foldCase: true })
    expect(await p.isProtected(join(t.root, 'EXAMS', 'key.DOCX'))).toBe(true)
    const accented = createProtectedPaths({
      folders: () => [join(t.root, 'Café')], // precomposed
      foldCase: true
    })
    expect(await accented.isProtected(join(t.root, 'Café', 'x.pdf'))).toBe(true) // e + accent
    expect(await accented.isProtected(join(t.root, 'Cafe', 'x.pdf'))).toBe(false)
  })

  it('is case sensitive where the disk is', async () => {
    const t = tree()
    const p = createProtectedPaths({ folders: () => [join(t.root, 'Exams')], foldCase: false })
    expect(await p.isProtected(join(t.root, 'EXAMS', 'Key.docx'))).toBe(false)
  })

  it('still protects a folder that is not there right now (an unplugged drive)', async () => {
    const t = tree()
    const gone = join(t.root, 'Volumes', 'USB', 'Exams')
    const p = createProtectedPaths({ folders: () => [gone], foldCase: false })
    expect(await p.isProtected(join(gone, 'Final.pdf'))).toBe(true)
    expect(await p.isProtected(t.lesson)).toBe(false)
  })

  it('treats a path it cannot examine as protected', async () => {
    const t = tree()
    const p = createProtectedPaths({
      folders: () => [join(t.root, 'Exams')],
      foldCase: false,
      realpath: async (path) => {
        if (path.endsWith('Plan.pdf')) throw Object.assign(new Error('nope'), { code: 'EACCES' })
        return path
      }
    })
    expect(await p.isProtected(t.lesson)).toBe(true)
  })

  it('protects nothing when no folder is listed, and never throws', async () => {
    const t = tree()
    const p = createProtectedPaths({ folders: () => [] })
    expect(await p.isProtected(t.exam)).toBe(false)
  })

  it('a listed folder of "/" protects everything', async () => {
    const p = createProtectedPaths({ folders: () => ['/'], foldCase: false })
    expect(await p.isProtected('/etc/hosts')).toBe(true)
  })

  it('reads the folder list afresh on every call', async () => {
    const t = tree()
    let list: string[] = []
    const p = createProtectedPaths({ folders: () => list, foldCase: false })
    expect(await p.isProtected(t.exam)).toBe(false)
    list = [join(t.root, 'Exams')]
    expect(await p.isProtected(t.exam)).toBe(true)
    list = []
    expect(await p.isProtected(t.exam)).toBe(false)
  })

  it('the lexical check needs no disk access', async () => {
    const snap = await createProtectedPaths({
      folders: () => ['/data/Exams'],
      foldCase: false,
      realpath: async (p) => p
    }).snapshot()
    expect(snap.lexical('/data/Exams/a.pdf')).toBe(true)
    expect(snap.lexical('/data/Exams-old/a.pdf')).toBe(false)
    expect(snap.lexical('/data/Exams/../Exams-old/a.pdf')).toBe(false)
  })
})

describe('file guard', () => {
  const setup = (allow: boolean, displays = 0) => {
    const t = tree()
    const guard = createFileGuard({
      paths: t.protect('Exams'),
      allowProtected: () => allow,
      externalDisplays: () => displays
    })
    return { t, guard }
  }

  it('refuses a protected file to a window that may not see them, and says where to open it', async () => {
    const { t, guard } = setup(false)
    await expect(guard.assertReadable(t.exam)).rejects.toThrow(PROTECTED_MESSAGE)
    await expect(guard.assertShareable(t.exam)).rejects.toThrow(PROTECTED_MESSAGE)
  })

  it('leaves ordinary files alone for everyone', async () => {
    const { t, guard } = setup(false)
    await guard.assertReadable(t.lesson)
    await guard.assertShareable(t.lesson)
  })

  it('lets the open Vault read protected files', async () => {
    const { t, guard } = setup(true)
    await guard.assertReadable(t.exam)
    await guard.assertShareable(t.exam)
  })

  it('refuses handing a protected file to another app while a display is connected', async () => {
    const { t, guard } = setup(true, 1)
    await guard.assertReadable(t.exam) // viewing inside the Vault is still fine
    await expect(guard.assertShareable(t.exam)).rejects.toThrow(PROTECTED_DISPLAY_MESSAGE)
    await guard.assertShareable(t.lesson) // other files are unaffected
  })

  it('does not judge values that are not paths; validation rejects them', async () => {
    const { guard } = setup(false)
    await guard.assertReadable(undefined)
    await guard.assertReadable(42)
  })
})
