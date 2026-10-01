import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeskService, FILE_CARD } from '../../src/main/deskService'
import { createFileGuard, createProtectedPaths } from '../../src/main/protected'
import { makePublicEnv } from './helpers'

function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tos-desk-')))
  mkdirSync(join(dir, 'PHIL 101'))
  mkdirSync(join(dir, 'Exams'))
  writeFileSync(join(dir, 'PHIL 101', 'syllabus.pdf'), 'pdf')
  writeFileSync(join(dir, 'Exams', 'final.docx'), 'key')
  const protectedList: string[] = [join(dir, 'Exams')]
  const pub = makePublicEnv()
  const guard = createFileGuard({
    paths: createProtectedPaths({ folders: () => protectedList }),
    allowProtected: () => false,
    externalDisplays: () => 0
  })
  return { dir, pub, desk: createDeskService(pub.repos.desk, guard), protectedList }
}

describe('the everyday desktop', () => {
  it('pins files and folders where they are dropped, as pointers to the real thing', async () => {
    const { dir, desk, pub } = setup()
    const file = await desk.pin({
      kind: 'file',
      path: join(dir, 'PHIL 101', 'syllabus.pdf'),
      x: 10.4,
      y: -20
    })
    expect(file).toMatchObject({
      kind: 'file',
      label: 'syllabus.pdf',
      fileKind: 'pdf',
      x: 10,
      y: -20,
      ...FILE_CARD,
      missing: false
    })
    const folder = await desk.pin({ kind: 'folder', path: join(dir, 'PHIL 101'), x: 0, y: 0 })
    expect(folder).toMatchObject({ kind: 'folder', label: 'PHIL 101' })
    expect((await desk.items()).map((i) => i.id)).toEqual([file.id, folder.id])
    expect(pub.events).toContainEqual({ name: 'desk.changed' })
  })

  it('refuses a protected file, a file posing as a folder, and a path that is not one', async () => {
    const { dir, desk } = setup()
    await expect(
      desk.pin({ kind: 'file', path: join(dir, 'Exams', 'final.docx'), x: 0, y: 0 })
    ).rejects.toThrow(/protected folder/)
    await expect(
      desk.pin({ kind: 'folder', path: join(dir, 'PHIL 101', 'syllabus.pdf'), x: 0, y: 0 })
    ).rejects.toThrow(/no longer there/)
    await expect(desk.pin({ kind: 'file', path: 'relative.pdf', x: 0, y: 0 })).rejects.toThrow(
      /valid/
    )
    await expect(
      desk.pin({ kind: 'file', path: join(dir, 'PHIL 101', 'syllabus.pdf'), x: 1e9, y: 0 })
    ).rejects.toThrow(/too far/)
    expect(await desk.items()).toEqual([])
  })

  it('stops showing a pin once its folder is protected, and marks one that is gone', async () => {
    const { dir, desk, protectedList } = setup()
    await desk.pin({ kind: 'folder', path: join(dir, 'PHIL 101'), x: 0, y: 0 })
    await desk.pin({ kind: 'file', path: join(dir, 'PHIL 101', 'syllabus.pdf'), x: 0, y: 0 })
    protectedList.push(join(dir, 'PHIL 101', 'syllabus.pdf'))
    let items = await desk.items()
    expect(items.map((i) => i.label)).toEqual(['PHIL 101'])
    protectedList.pop()
    writeFileSync(join(dir, 'PHIL 101', 'syllabus.pdf'), 'pdf')
    const { rmSync } = await import('node:fs')
    rmSync(join(dir, 'PHIL 101', 'syllabus.pdf'))
    items = await desk.items()
    expect(items.find((i) => i.label === 'syllabus.pdf')?.missing).toBe(true)
  })

  it('makes labelled areas, listed under everything else, and moves an area with what is on it', async () => {
    const { dir, desk } = setup()
    const pin = await desk.pin({
      kind: 'file',
      path: join(dir, 'PHIL 101', 'syllabus.pdf'),
      x: 50,
      y: 50
    })
    const area = await desk.addArea({ label: ' Monday ', x: 0, y: 0, w: 10, h: 10 })
    expect(area).toMatchObject({
      kind: 'area',
      label: 'Monday',
      color: 'blue',
      w: 160,
      h: 120,
      path: null
    })
    expect((await desk.items())[0].id).toBe(area.id)
    const moved = await desk.arrange([
      { id: area.id, patch: { x: 100, y: 100, label: 'Tuesday', color: 'green' } },
      { id: pin.id, patch: { x: 150, y: 150, w: 999, label: 'renamed?' } }
    ])
    expect(moved[0]).toMatchObject({ x: 100, y: 100, label: 'Tuesday', color: 'green' })
    // A file card keeps its size and its name.
    expect(moved[1]).toMatchObject({ x: 150, y: 150, w: FILE_CARD.w, label: 'syllabus.pdf' })
    await expect(desk.arrange([{ id: area.id, patch: { color: 'plaid' } }])).rejects.toThrow(
      /Colour/
    )
  })

  it('removes a pin without touching the file, and follows a renamed one', async () => {
    const { dir, desk, pub } = setup()
    const folder = await desk.pin({ kind: 'folder', path: join(dir, 'PHIL 101'), x: 0, y: 0 })
    const file = await desk.pin({
      kind: 'file',
      path: join(dir, 'PHIL 101', 'syllabus.pdf'),
      x: 0,
      y: 0
    })
    pub.repos.desk.repath(join(dir, 'PHIL 101'), join(dir, 'PHIL 102'))
    const rows = pub.repos.desk.list()
    expect(rows.find((r) => r.id === folder.id)).toMatchObject({
      path: join(dir, 'PHIL 102'),
      label: 'PHIL 102'
    })
    expect(rows.find((r) => r.id === file.id)).toMatchObject({
      path: join(dir, 'PHIL 102', 'syllabus.pdf'),
      label: 'syllabus.pdf'
    })
    // A folder whose name only starts the same is not inside it.
    pub.repos.desk.repath(join(dir, 'PHIL 10'), join(dir, 'X'))
    expect(pub.repos.desk.get(folder.id)?.path).toBe(join(dir, 'PHIL 102'))
    await desk.remove(file.id)
    expect((await desk.items()).map((i) => i.id)).toEqual([folder.id])
    await expect(desk.remove(file.id)).rejects.toThrow(/no longer on the desktop/)
  })
})
