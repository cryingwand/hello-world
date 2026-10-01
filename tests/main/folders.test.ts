import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanName, createFolders } from '../../src/main/folders'
import { createFileGuard, createProtectedPaths } from '../../src/main/protected'

/** A pretend home folder with Desktop, Documents, a course folder and a protected Exams folder. */
function setup(opts: { vault?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tos-folders-')))
  const home = join(root, 'home')
  for (const d of [
    'Desktop',
    'Documents',
    'Downloads',
    'Documents/PHIL 101',
    'Documents/PHIL 101/Exams'
  ])
    mkdirSync(join(home, d), { recursive: true })
  writeFileSync(join(home, 'Documents/PHIL 101/syllabus.pdf'), 'pdf')
  writeFileSync(join(home, 'Documents/PHIL 101/notes.md'), 'notes')
  writeFileSync(join(home, 'Documents/PHIL 101/.DS_Store'), '')
  writeFileSync(join(home, 'Documents/PHIL 101/Exams/final key.docx'), 'key')
  const outside = join(root, 'elsewhere')
  mkdirSync(outside)
  writeFileSync(join(outside, 'system.txt'), 'x')
  const exams = join(home, 'Documents/PHIL 101/Exams')
  const guard = createFileGuard({
    paths: createProtectedPaths({ folders: () => [exams] }),
    allowProtected: () => opts.vault === true,
    externalDisplays: () => 0
  })
  const trashed: string[] = []
  const changes: string[] = []
  const moved: [string, string][] = []
  const folders = createFolders({
    home,
    teachingFolders: () => [join(home, 'Documents/PHIL 101')],
    guard,
    trash: async (p) => {
      trashed.push(p)
    },
    changed: () => changes.push('changed'),
    moved: (from, to) => moved.push([from, to])
  })
  const course = join(home, 'Documents/PHIL 101')
  return { root, home, course, exams, outside, folders, trashed, changes, moved }
}

describe('folders: browsing', () => {
  it('lists the places that exist, teaching folders last', async () => {
    const { folders, home, course } = setup()
    const places = await folders.places()
    expect(places.map((p) => p.name)).toEqual([
      'Home',
      'Desktop',
      'Documents',
      'Downloads',
      'PHIL 101'
    ])
    expect(places[0].path).toBe(home)
    expect(places.at(-1)).toMatchObject({ path: course, kind: 'teaching' })
  })

  it('lists a folder, folders first, without hidden files or protected ones', async () => {
    const { folders, course, home } = setup()
    const l = await folders.list(course)
    expect(l.entries.map((e) => e.name)).toEqual(['notes.md', 'syllabus.pdf'])
    expect(l.entries[1]).toMatchObject({ isDir: false, kind: 'pdf', size: 3 })
    expect(l).toMatchObject({ name: 'PHIL 101', parent: join(home, 'Documents'), writable: true })
  })

  it('shows protected folders and files only to the open Vault', async () => {
    const { folders, course, exams } = setup({ vault: true })
    expect((await folders.list(course)).entries.map((e) => e.name)).toEqual([
      'Exams',
      'notes.md',
      'syllabus.pdf'
    ])
    const inside = await folders.list(exams)
    expect(inside.entries.map((e) => e.name)).toEqual(['final key.docx'])
    expect(inside.writable).toBe(false)

    const everyday = setup()
    await expect(everyday.folders.list(everyday.exams)).rejects.toThrow(/protected folder/)
  })

  it('can look outside the home folder but not change anything there', async () => {
    const { folders, outside } = setup()
    const l = await folders.list(outside)
    expect(l.entries.map((e) => e.name)).toEqual(['system.txt'])
    expect(l.writable).toBe(false)
    await expect(folders.rename(join(outside, 'system.txt'), 'x.txt')).rejects.toThrow(
      /inside your home folder/
    )
    await expect(folders.createFolder(outside, 'New')).rejects.toThrow(/inside your home folder/)
  })

  it('refuses what is not a folder path', async () => {
    const { folders, course } = setup()
    await expect(folders.list('relative/path')).rejects.toThrow(/not a valid/)
    await expect(folders.list(join(course, 'syllabus.pdf'))).rejects.toThrow(/no longer there/)
    await expect(folders.list(join(course, 'nope'))).rejects.toThrow(/no longer there/)
  })
})

describe('folders: changes', () => {
  it('makes a folder, and refuses a name that is taken or not a name', async () => {
    const { folders, course, changes } = setup()
    const made = await folders.createFolder(course, ' Week 1 ')
    expect(made).toBe(join(course, 'Week 1'))
    expect(existsSync(made)).toBe(true)
    expect(changes).toEqual(['changed'])
    await expect(folders.createFolder(course, 'Week 1')).rejects.toThrow(/already something/)
    for (const bad of ['', 'a/b', '.hidden', 'a:b', 'x'.repeat(256)]) {
      expect(() => cleanName(bad)).toThrow()
    }
  })

  it('renames without ever replacing a file, and tells pins where it went', async () => {
    const { folders, course, moved } = setup()
    const from = join(course, 'notes.md')
    const to = await folders.rename(from, 'Lecture notes.md')
    expect(to).toBe(join(course, 'Lecture notes.md'))
    expect(moved).toEqual([[from, to]])
    await expect(folders.rename(to, 'syllabus.pdf')).rejects.toThrow(/already something/)
    expect(readdirSync(course).sort()).toEqual([
      '.DS_Store',
      'Exams',
      'Lecture notes.md',
      'syllabus.pdf'
    ])
  })

  it('moves files into a folder, all or nothing', async () => {
    const { folders, course, home } = setup()
    const week = await folders.createFolder(course, 'Week 1')
    const a = join(course, 'notes.md')
    const b = join(course, 'syllabus.pdf')
    expect(await folders.move([a, b], week)).toEqual([
      join(week, 'notes.md'),
      join(week, 'syllabus.pdf')
    ])
    writeFileSync(join(course, 'notes.md'), 'again')
    // One clash refuses the whole move.
    await expect(
      folders.move([join(week, 'syllabus.pdf'), join(week, 'notes.md')], course)
    ).rejects.toThrow(/already something/)
    expect(existsSync(join(week, 'syllabus.pdf'))).toBe(true)
    await expect(folders.move([week], course)).resolves.toEqual([])
    await expect(folders.move([week], week)).rejects.toThrow(/inside itself/)
    await expect(folders.move([course], week)).rejects.toThrow(/inside itself/)
    await expect(folders.move([join(home, 'Desktop')], course)).rejects.toThrow(/stays where it is/)
  })

  it('never moves, renames or trashes a protected folder, or a folder that holds one', async () => {
    const { folders, course, exams, home } = setup({ vault: true })
    await expect(folders.rename(exams, 'Old exams')).rejects.toThrow(/protected folder/)
    await expect(folders.trash([join(exams, 'final key.docx')])).rejects.toThrow(/protected folder/)
    await expect(folders.rename(course, 'PHIL 102')).rejects.toThrow(/holds a protected folder/)
    await expect(folders.move([course], join(home, 'Desktop'))).rejects.toThrow(
      /holds a protected folder/
    )
    await expect(folders.createFolder(exams, 'New')).rejects.toThrow(/protected folder/)
    await expect(folders.move([join(course, 'notes.md')], exams)).rejects.toThrow(
      /protected folder/
    )
  })

  it('trashes through the Mac’s Trash only, after checking every item first', async () => {
    const { folders, course, home, trashed, outside } = setup()
    const a = join(course, 'notes.md')
    await expect(folders.trash([a, join(outside, 'system.txt')])).rejects.toThrow(/home folder/)
    expect(trashed).toEqual([])
    await expect(folders.trash([join(home, 'Documents')])).rejects.toThrow(/stays where it is/)
    await folders.trash([a])
    expect(trashed).toEqual([a])
    await expect(folders.trash([])).rejects.toThrow()
  })

  it('does not follow a link out of the home folder to change something', async () => {
    const { folders, home, outside } = setup()
    symlinkSync(outside, join(home, 'Desktop', 'shortcut'))
    await expect(
      folders.rename(join(home, 'Desktop', 'shortcut', 'system.txt'), 'gotcha.txt')
    ).rejects.toThrow(/inside your home folder/)
  })
})
