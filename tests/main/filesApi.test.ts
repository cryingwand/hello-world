import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/models'
import { createFilesApi, type FilesEnv } from '../../src/main/filesApi'

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
