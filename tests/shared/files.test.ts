import { describe, expect, it } from 'vitest'
import {
  baseName,
  dirName,
  extOf,
  fromFileUrl,
  kindOf,
  preferredApp,
  splitWorkArea,
  toFileUrl,
  viewerFor
} from '@shared/files'

describe('file kinds', () => {
  it.each([
    ['/a/b/Unit 1.PDF', 'pdf'],
    ['/a/photo.JPeG', 'image'],
    ['/a/notes.md', 'text'],
    ['/a/notes.txt', 'text'],
    ['/a/letter.rtf', 'rtf'],
    ['/a/essay.docx', 'docx'],
    ['/a/grades.xlsx', 'spreadsheet'],
    ['/a/export.csv', 'spreadsheet'],
    ['/a/slides.pptx', 'pptx'],
    ['/a/old.doc', 'other'],
    ['/a/README', 'other'],
    ['/a/.hidden', 'other']
  ])('%s is %s', (path, kind) => expect(kindOf(path)).toBe(kind))

  it('splits names and extensions sanely', () => {
    expect(extOf('/a/b.c/file')).toBe('')
    expect(extOf('/a/archive.tar.gz')).toBe('gz')
    expect(baseName('/a/b/c.txt')).toBe('c.txt')
    expect(dirName('/a/b/c.txt')).toBe('/a/b')
    expect(dirName('/c.txt')).toBe('/')
  })
})

describe('preferredApp', () => {
  it.each([
    ['/a.pdf', 'Preview'],
    ['/a.png', 'Preview'],
    ['/a.txt', 'TextEdit'],
    ['/a.rtf', 'TextEdit'],
    ['/a.docx', 'Microsoft Word'],
    ['/a.doc', 'Microsoft Word'],
    ['/a.xlsx', 'Microsoft Excel'],
    ['/a.csv', 'Microsoft Excel'],
    ['/a.xls', 'Microsoft Excel'],
    ['/a.pptx', 'Microsoft PowerPoint'],
    ['/a.ppt', 'Microsoft PowerPoint'],
    ['/a.pages', 'default'],
    ['/a', 'default']
  ])('%s opens in %s', (path, app) => expect(preferredApp(path)).toBe(app))
})

describe('viewerFor', () => {
  it('shows built-in viewers where the plan calls for them and thumbnails otherwise', () => {
    expect(viewerFor('pdf')).toBe('pdf')
    expect(viewerFor('image')).toBe('image')
    expect(viewerFor('text')).toBe('text')
    expect(viewerFor('docx')).toBe('docx')
    expect(viewerFor('spreadsheet')).toBe('table')
    expect(viewerFor('pptx')).toBe('thumbnail')
    expect(viewerFor('rtf')).toBe('thumbnail')
    expect(viewerFor('other')).toBe('thumbnail')
  })
})

describe('file URLs', () => {
  it.each([
    '/Users/t/Documents/Unit 1 Quiz.pdf',
    '/Users/t/Courses/50%/a#b?c.pdf',
    '/Users/t/Mañana/résumé (final).png',
    '/Users/t/日本語/ファイル.pdf',
    "/Users/t/it's/a&b=c.pdf"
  ])('round-trips %s', (path) => {
    const url = toFileUrl(path)
    expect(url.startsWith('tos-file://local/')).toBe(true)
    expect(url).not.toMatch(/[ #?](?![^/]*$)/)
    expect(fromFileUrl(url)).toBe(path)
  })

  it('rejects URLs that are not ours', () => {
    expect(fromFileUrl('file:///etc/passwd')).toBeNull()
    expect(fromFileUrl('https://local/a.pdf')).toBeNull()
    expect(fromFileUrl('tos-file://evil/a.pdf')).toBeNull()
    expect(fromFileUrl('not a url')).toBeNull()
    expect(fromFileUrl('tos-file://local/%E0%A4%A')).toBeNull()
  })
})

describe('splitWorkArea', () => {
  it('halves the work area with no gap or overlap, including odd widths and offsets', () => {
    const area = { x: 0, y: 25, width: 1441, height: 800 }
    const { left, right } = splitWorkArea(area)
    expect(left).toEqual({ x: 0, y: 25, width: 720, height: 800 })
    expect(right).toEqual({ x: 720, y: 25, width: 721, height: 800 })
    expect(left.x + left.width).toBe(right.x)
    expect(right.x + right.width).toBe(area.x + area.width)
  })

  it('keeps a second display offset', () => {
    const { left, right } = splitWorkArea({ x: 1440, y: 0, width: 1920, height: 1055 })
    expect(left.x).toBe(1440)
    expect(right.x).toBe(2400)
  })
})
