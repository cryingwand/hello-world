import { Document, Packer, Paragraph, TextRun } from 'docx'
import ExcelJS from 'exceljs'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { toFileUrl } from '@shared/files'
import {
  MAX_TEXT_BYTES,
  assertFile,
  docxHtml,
  fileInfo,
  readText,
  resolveServedPath,
  tableView,
  writeText
} from '../../src/main/files'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-files-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('assertFile', () => {
  it('accepts an existing absolute file and normalises the path', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.txt'), 'x')
    const f = await assertFile(`${d}/sub/../a.txt`.replace('/sub/..', '/x/..'))
    expect(f.path).toBe(join(d, 'a.txt'))
  })

  it.each([
    ['a relative path', 'notes/a.txt'],
    ['an empty string', ''],
    ['a NUL byte', '/tmp/a\0.txt'],
    ['a non-string', 42 as never]
  ])('rejects %s', async (_l, p) => {
    await expect(assertFile(p)).rejects.toThrow(/not a valid file path/)
  })

  it('rejects missing files and directories', async () => {
    const d = tmp()
    await expect(assertFile(join(d, 'nope.txt'))).rejects.toThrow(/no longer exists/)
    await expect(assertFile(d)).rejects.toThrow(/not a file/)
  })

  it('enforces a size limit with a helpful message', async () => {
    const d = tmp()
    writeFileSync(join(d, 'big.bin'), Buffer.alloc(3 * 1024 * 1024))
    await expect(assertFile(join(d, 'big.bin'), 1024 * 1024)).rejects.toThrow(
      /too large.*Open it in its app/
    )
  })
})

describe('fileInfo', () => {
  it('describes a file, and returns null rather than throwing when it is gone', async () => {
    const d = tmp()
    writeFileSync(join(d, 'Quiz.docx'), 'abc')
    expect(await fileInfo(join(d, 'Quiz.docx'))).toMatchObject({
      name: 'Quiz.docx',
      kind: 'docx',
      size: 3
    })
    expect(await fileInfo(join(d, 'gone.docx'))).toBeNull()
    expect(await fileInfo('relative.txt')).toBeNull()
  })
})

describe('readText / writeText', () => {
  it('reads a text file with its mtime', async () => {
    const d = tmp()
    writeFileSync(join(d, 'n.md'), '# Héllo ✓')
    const t = await readText(join(d, 'n.md'))
    expect(t).toMatchObject({ text: '# Héllo ✓', truncated: false })
    expect(t.mtime).toBeGreaterThan(0)
  })

  it('only reads what it will show from a huge file', async () => {
    const d = tmp()
    writeFileSync(join(d, 'log.txt'), 'a'.repeat(MAX_TEXT_BYTES + 5000))
    const t = await readText(join(d, 'log.txt'))
    expect(t.truncated).toBe(true)
    expect(t.text.length).toBe(MAX_TEXT_BYTES)
  })

  it('will not read or write other file types', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.docx'), 'x')
    await expect(readText(join(d, 'a.docx'))).rejects.toThrow(/Only .txt and .md/)
    const mtime = statSync(join(d, 'a.docx')).mtimeMs
    await expect(writeText(join(d, 'a.docx'), 'y', mtime)).rejects.toThrow(/Only .txt and .md/)
  })

  it('saves atomically, leaves no temp file, and keeps permissions', async () => {
    const d = tmp()
    const p = join(d, 'n.txt')
    writeFileSync(p, 'old')
    chmodSync(p, 0o640)
    const { mtime } = await readText(p)
    const res = await writeText(p, 'new text', mtime)
    expect(readFileSync(p, 'utf8')).toBe('new text')
    expect(res.mtime).toBe(statSync(p).mtimeMs)
    expect(readdirSync(d)).toEqual(['n.txt'])
    expect(statSync(p).mode & 0o777).toBe(0o640)
  })

  it('refuses to overwrite a file that changed on disk since it was opened', async () => {
    const d = tmp()
    const p = join(d, 'n.txt')
    writeFileSync(p, 'v1')
    const { mtime } = await readText(p)
    writeFileSync(p, 'edited elsewhere')
    utimesSync(p, new Date(), new Date(Date.now() + 5000))
    await expect(writeText(p, 'my edit', mtime)).rejects.toThrow(/changed on disk/)
    expect(readFileSync(p, 'utf8')).toBe('edited elsewhere')
  })

  it('allows consecutive saves using the returned mtime', async () => {
    const d = tmp()
    const p = join(d, 'n.md')
    writeFileSync(p, 'a')
    const opened = await readText(p)
    const first = await writeText(p, 'b', opened.mtime)
    await writeText(p, 'c', first.mtime)
    expect(readFileSync(p, 'utf8')).toBe('c')
  })

  it('refuses to save into a file too large to edit, and oversized content', async () => {
    const d = tmp()
    writeFileSync(join(d, 'big.txt'), 'a'.repeat(MAX_TEXT_BYTES + 1))
    await expect(
      writeText(join(d, 'big.txt'), 'x', statSync(join(d, 'big.txt')).mtimeMs)
    ).rejects.toThrow(/too large to edit/)
    writeFileSync(join(d, 'ok.txt'), 'a')
    await expect(
      writeText(
        join(d, 'ok.txt'),
        'a'.repeat(MAX_TEXT_BYTES + 1),
        statSync(join(d, 'ok.txt')).mtimeMs
      )
    ).rejects.toThrow(/too much text/)
    expect(readFileSync(join(d, 'ok.txt'), 'utf8')).toBe('a')
  })

  it('does not create files that do not exist', async () => {
    const d = tmp()
    await expect(writeText(join(d, 'new.txt'), 'x', 0)).rejects.toThrow(/no longer exists/)
    expect(existsSync(join(d, 'new.txt'))).toBe(false)
  })
})

describe('docxHtml', () => {
  it('converts a Word document to HTML', async () => {
    const d = tmp()
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun({ text: 'Unit 3 Quiz', bold: true })] }),
            new Paragraph('Name: ______')
          ]
        }
      ]
    })
    writeFileSync(join(d, 'q.docx'), await Packer.toBuffer(doc))
    const res = await docxHtml(join(d, 'q.docx'))
    expect(res.html).toContain('<strong>Unit 3 Quiz</strong>')
    expect(res.html).toContain('Name: ______')
  })

  it('reports a corrupt document in plain words and rejects other types', async () => {
    const d = tmp()
    writeFileSync(join(d, 'bad.docx'), 'not a zip')
    await expect(docxHtml(join(d, 'bad.docx'))).rejects.toThrow(
      /could not be read.*Open it in Word/
    )
    writeFileSync(join(d, 'a.txt'), 'x')
    await expect(docxHtml(join(d, 'a.txt'))).rejects.toThrow(/Only .docx/)
  })
})

describe('tableView', () => {
  it('shows xlsx and csv as rows, capping large sheets', async () => {
    const d = tmp()
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Grades')
    ws.addRow(Array.from({ length: 70 }, (_, i) => `c${i}`))
    for (let r = 0; r < 600; r++) ws.addRow([`r${r}`, r])
    await wb.xlsx.writeFile(join(d, 'g.xlsx'))
    const t = await tableView(join(d, 'g.xlsx'))
    expect(t.rows).toHaveLength(500)
    expect(t.rows[0]).toHaveLength(60)
    expect(t.truncated).toBe(true)
    expect(t.sheet).toBe('Grades')

    writeFileSync(join(d, 's.csv'), 'a,b\n1,2\n')
    expect(await tableView(join(d, 's.csv'))).toEqual({
      sheetNames: [],
      sheet: null,
      rows: [
        ['a', 'b'],
        ['1', '2']
      ],
      truncated: false
    })
  })
})

describe('resolveServedPath (the tos-file:// protocol guard)', () => {
  it('serves an existing pdf or image', async () => {
    const d = tmp()
    writeFileSync(join(d, 'Unit 1 & 2.pdf'), '%PDF')
    writeFileSync(join(d, 'p.png'), 'x')
    expect(await resolveServedPath(toFileUrl(join(d, 'Unit 1 & 2.pdf')))).toBe(
      join(d, 'Unit 1 & 2.pdf')
    )
    expect(await resolveServedPath(toFileUrl(join(d, 'p.png')))).toBe(join(d, 'p.png'))
  })

  it('refuses everything else: other types, missing files, directories, foreign URLs', async () => {
    const d = tmp()
    mkdirSync(join(d, 'folder.pdf'))
    writeFileSync(join(d, 'secret.txt'), 'x')
    writeFileSync(join(d, 'data.sqlite'), 'x')
    await expect(resolveServedPath(toFileUrl(join(d, 'secret.txt')))).rejects.toThrow(/not served/)
    await expect(resolveServedPath(toFileUrl(join(d, 'data.sqlite')))).rejects.toThrow(/not served/)
    await expect(resolveServedPath(toFileUrl(join(d, 'missing.pdf')))).rejects.toThrow(
      /no longer exists/
    )
    await expect(resolveServedPath(toFileUrl(join(d, 'folder.pdf')))).rejects.toThrow(/not a file/)
    await expect(resolveServedPath('file:///etc/passwd')).rejects.toThrow(/Bad file URL/)
    await expect(resolveServedPath('tos-file://evil/x.pdf')).rejects.toThrow(/Bad file URL/)
  })

  it('cannot be tricked with dot segments or encoded traversal into serving other types', async () => {
    const d = tmp()
    writeFileSync(join(d, 'secret.txt'), 'x')
    mkdirSync(join(d, 'sub'))
    writeFileSync(join(d, 'sub', 'a.pdf'), '%PDF')
    await expect(resolveServedPath(`tos-file://local${d}/sub/../secret.txt`)).rejects.toThrow(
      /not served/
    )
    await expect(resolveServedPath(`tos-file://local${d}/sub/%2e%2e/secret.txt`)).rejects.toThrow(
      /not served/
    )
    // A .pdf symlink is followed by the filesystem, which is what a user would expect for their own links.
    symlinkSync(join(d, 'sub', 'a.pdf'), join(d, 'link.pdf'))
    expect(await resolveServedPath(toFileUrl(join(d, 'link.pdf')))).toBe(join(d, 'link.pdf'))
  })
})
