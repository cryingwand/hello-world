import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/models'
import { createFilesApi, type FilesEnv } from '../../src/main/filesApi'
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

function make(over: Partial<FilesEnv> = {}) {
  const d = mkdtempSync(join(tmpdir(), 'tos-api-'))
  dirs.push(d)
  const calls: { cmd: string; args: string[] }[] = []
  const revealed: string[] = []
  let restored = 0
  const api = createFilesApi({
    settings: () => ({ ...DEFAULT_SETTINGS, teachingFolders: [d] }),
    exec: async (cmd, args) => {
      calls.push({ cmd, args })
      return { stdout: cmd === 'mdfind' ? `${join(d, 'Unit 3.pdf')}\n` : 'ok\n', stderr: '' }
    },
    home: '/Users/t',
    isMac: () => true,
    isTrusted: () => true,
    launcher: {
      snapLeft: async () => ({ x: 100, y: 0, width: 100, height: 100 }),
      restore: () => void restored++
    },
    thumbnail: async () => 'data:image/png;base64,AAAA',
    reveal: (p) => void revealed.push(p),
    pickFile: async () => '/picked.pdf',
    guard: createFileGuard({
      paths: createProtectedPaths({ folders: () => [] }),
      allowProtected: () => false,
      externalDisplays: () => 0
    }),
    pollMs: 1,
    snapTimeoutMs: 50,
    ...over
  })
  return { api, d, calls, revealed, restored: () => restored }
}

describe('files api', () => {
  it('searches with the configured teaching folders and marks their results', async () => {
    const { api, d, calls } = make()
    writeFileSync(join(d, 'Unit 3.pdf'), '%PDF')
    const res = await api.search({ text: 'unit', teachingOnly: false, includeContents: false })
    expect(res.results[0]).toMatchObject({ name: 'Unit 3.pdf', isTeaching: true, kind: 'pdf' })
    expect(calls.map((c) => c.args[0])).toContain('-onlyin')
  })

  it('validates the path before opening anything', async () => {
    const { api, calls } = make()
    await expect(
      api.open({ path: '/no/such/file.docx', app: 'Microsoft Word', snap: true })
    ).rejects.toThrow(/no longer exists/)
    await expect(
      api.open({ path: 'relative.docx', app: 'Microsoft Word', snap: true })
    ).rejects.toThrow(/not a valid file path/)
    expect(calls).toHaveLength(0)
  })

  it('opens and snaps a real file', async () => {
    const { api, d, calls } = make()
    writeFileSync(join(d, 'Quiz.docx'), 'x')
    const res = await api.open({ path: join(d, 'Quiz.docx'), app: 'Microsoft Word', snap: true })
    expect(res).toEqual({ opened: true, snapped: true })
    expect(calls.map((c) => c.cmd)).toEqual(['open', 'osascript'])
  })

  it('reveals only files that exist and forwards restoreLayout', async () => {
    const { api, d, revealed, restored } = make()
    writeFileSync(join(d, 'a.pdf'), 'x')
    await api.reveal(join(d, 'a.pdf'))
    await expect(api.reveal(join(d, 'nope.pdf'))).rejects.toThrow()
    await api.restoreLayout()
    expect(revealed).toEqual([join(d, 'a.pdf')])
    expect(restored()).toBe(1)
  })

  it('returns null thumbnails on failure instead of throwing', async () => {
    const { api, d } = make({ thumbnail: async () => Promise.reject(new Error('no quicklook')) })
    writeFileSync(join(d, 'a.pptx'), 'x')
    expect(await api.thumbnail(join(d, 'a.pptx'))).toBeNull()
  })

  it('returns the thumbnail data URL when available', async () => {
    const { api, d } = make()
    writeFileSync(join(d, 'a.pptx'), 'x')
    expect(await api.thumbnail(join(d, 'a.pptx'))).toBe('data:image/png;base64,AAAA')
  })

  it('requires a numeric mtime to save text', async () => {
    const { api, d } = make()
    writeFileSync(join(d, 'a.txt'), 'x')
    await expect(api.writeText(join(d, 'a.txt'), 'y', 'now' as never)).rejects.toThrow(
      /mtime must be a number/
    )
  })
})

describe('files api and protected folders', () => {
  /** A teaching folder with an Exams folder inside it that is protected. */
  function protectedSetup(role: { allow: boolean; displays?: number }) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'tos-fprot-')))
    dirs.push(root)
    mkdirSync(join(root, 'Exams'))
    const exam = join(root, 'Exams', 'Final Exam.pdf')
    const notes = join(root, 'Exams', 'Key.txt')
    const plan = join(root, 'Final Plan.pdf')
    writeFileSync(exam, '%PDF')
    writeFileSync(notes, 'the answers')
    writeFileSync(plan, '%PDF')
    const calls: { cmd: string; args: string[] }[] = []
    const picked = { path: exam }
    const made = make({
      settings: () => ({ ...DEFAULT_SETTINGS, teachingFolders: [root] }),
      exec: async (cmd, args) => {
        calls.push({ cmd, args })
        return { stdout: cmd === 'mdfind' ? `${exam}\n${plan}\n` : 'ok\n', stderr: '' }
      },
      pickFile: async () => picked.path,
      guard: createFileGuard({
        paths: createProtectedPaths({ folders: () => [join(root, 'Exams')], foldCase: false }),
        allowProtected: () => role.allow,
        externalDisplays: () => role.displays ?? 0
      })
    })
    return { ...made, root, exam, notes, plan, calls, picked }
  }
  const search = (api: ReturnType<typeof make>['api']) =>
    api.search({ text: 'final', teachingOnly: false, includeContents: false })

  it('hides protected files from search entirely outside the Vault', async () => {
    const { api, plan } = protectedSetup({ allow: false })
    const res = await search(api)
    expect(res.results.map((r) => r.path)).toEqual([plan])
    expect(JSON.stringify(res)).not.toContain('Exam')
  })

  it('does not let protected files use up the result limit', async () => {
    const { api, plan } = protectedSetup({ allow: false })
    const res = await api.search({
      text: 'final',
      teachingOnly: false,
      includeContents: false,
      limit: 1
    })
    expect(res.results.map((r) => r.path)).toEqual([plan])
    expect(res.truncated).toBe(false)
  })

  it('shows protected files, marked, to the open Vault', async () => {
    const { api, exam, plan } = protectedSetup({ allow: true })
    const res = await search(api)
    const byPath = new Map(res.results.map((r) => [r.path, r]))
    expect(byPath.get(exam)?.isProtected).toBe(true)
    expect(byPath.get(plan)?.isProtected).toBeUndefined()
  })

  it('refuses every read of a protected file outside the Vault, and reports it as missing to info', async () => {
    const { api, exam, notes, calls } = protectedSetup({ allow: false })
    expect(await api.info(exam)).toBeNull()
    await expect(api.readText(notes)).rejects.toThrow(PROTECTED_MESSAGE)
    await expect(api.writeText(notes, 'x', 0)).rejects.toThrow(PROTECTED_MESSAGE)
    await expect(api.docxHtml(exam)).rejects.toThrow(PROTECTED_MESSAGE)
    await expect(api.table(exam)).rejects.toThrow(PROTECTED_MESSAGE)
    await expect(api.thumbnail(exam)).rejects.toThrow(PROTECTED_MESSAGE)
    await expect(api.open({ path: exam, app: 'Preview', snap: false })).rejects.toThrow(
      PROTECTED_MESSAGE
    )
    await expect(api.reveal(exam)).rejects.toThrow(PROTECTED_MESSAGE)
    expect(calls.filter((c) => c.cmd !== 'mdfind')).toEqual([]) // nothing was launched
  })

  it('refuses a protected file chosen in the native picker', async () => {
    const { api, plan, picked } = protectedSetup({ allow: false })
    await expect(api.pickFile()).rejects.toThrow(PROTECTED_MESSAGE)
    picked.path = plan
    expect(await api.pickFile()).toBe(plan)
  })

  it('refuses a symlink that points into a protected folder', async () => {
    const { api, root, notes } = protectedSetup({ allow: false })
    const link = join(root, 'innocent.txt')
    symlinkSync(notes, link)
    await expect(api.readText(link)).rejects.toThrow(PROTECTED_MESSAGE)
  })

  it('lets the open Vault read, flag and edit a protected file', async () => {
    const { api, exam, notes } = protectedSetup({ allow: true })
    expect(await api.info(exam)).toMatchObject({ name: 'Final Exam.pdf', isProtected: true })
    const t = await api.readText(notes)
    expect(t.text).toBe('the answers')
    await api.writeText(notes, 'new answers', t.mtime)
    expect((await api.readText(notes)).text).toBe('new answers')
  })

  it('treats a locked Vault like any other window', async () => {
    // allowProtected() is false while the Vault is locked, so its own window is refused too.
    const { api, exam } = protectedSetup({ allow: false })
    expect(await api.info(exam)).toBeNull()
  })

  it('opens a protected file natively from the Vault only when no other display is connected', async () => {
    const alone = protectedSetup({ allow: true, displays: 0 })
    expect(await alone.api.open({ path: alone.exam, app: 'Preview', snap: false })).toMatchObject({
      opened: true
    })
    const shared = protectedSetup({ allow: true, displays: 1 })
    await expect(
      shared.api.open({ path: shared.exam, app: 'Preview', snap: false })
    ).rejects.toThrow(PROTECTED_DISPLAY_MESSAGE)
    await expect(shared.api.reveal(shared.exam)).rejects.toThrow(PROTECTED_DISPLAY_MESSAGE)
    expect(shared.calls.filter((c) => c.cmd !== 'mdfind')).toEqual([])
    // Viewing inside the Vault is still allowed, and ordinary files still open.
    await shared.api.readText(shared.notes)
    expect(await shared.api.open({ path: shared.plan, app: 'Preview', snap: false })).toMatchObject(
      { opened: true }
    )
  })
})
