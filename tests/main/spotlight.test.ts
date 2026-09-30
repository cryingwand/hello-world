import { describe, expect, it } from 'vitest'
import type { Exec } from '../../src/main/mac/exec'
import {
  buildMdQuery,
  isNoisePath,
  mdEscape,
  nameRank,
  searchFiles,
  teachingFolderFor,
  type SpotlightDeps
} from '../../src/main/mac/spotlight'

const HOME = '/Users/tyler'

describe('mdEscape and buildMdQuery', () => {
  it('escapes quotes, backslashes and wildcards so they match literally', () => {
    expect(mdEscape('say "hi"')).toBe('say \\"hi\\"')
    expect(mdEscape('a\\b*c')).toBe('a\\\\b\\*c')
    expect(mdEscape('line1\nline2')).toBe('line1 line2')
  })

  it('ANDs every word against the display name or file name, ignoring case and diacritics', () => {
    expect(buildMdQuery('unit 3  quiz', false)).toBe(
      '(kMDItemDisplayName == "*unit*"cd || kMDItemFSName == "*unit*"cd) && ' +
        '(kMDItemDisplayName == "*3*"cd || kMDItemFSName == "*3*"cd) && ' +
        '(kMDItemDisplayName == "*quiz*"cd || kMDItemFSName == "*quiz*"cd)'
    )
  })

  it('adds text content matching when asked', () => {
    expect(buildMdQuery('mitosis', true)).toBe(
      '(kMDItemDisplayName == "*mitosis*"cd || kMDItemFSName == "*mitosis*"cd || kMDItemTextContent == "mitosis"cd)'
    )
  })

  it('returns null for empty input', () => {
    expect(buildMdQuery('   ', false)).toBeNull()
  })

  it('cannot be broken out of by hostile text', () => {
    const q = buildMdQuery('x" || kMDItemKind == "*', false)!
    // Every quote from the user is escaped, so only the query's own quotes remain unescaped.
    expect(q.replace(/\\"/g, '').match(/"/g)!.length % 2).toBe(0)
    expect(q).toContain('x\\"')
  })
})

describe('teachingFolderFor', () => {
  const folders = ['/Users/tyler/Documents/Courses', '/Users/tyler/Lessons/']
  it('matches on folder boundaries, case-insensitively', () => {
    expect(teachingFolderFor('/Users/tyler/Documents/Courses/Bio/a.pdf', folders)).toBe(
      '/Users/tyler/Documents/Courses'
    )
    expect(teachingFolderFor('/users/TYLER/documents/courses/a.pdf', folders)).toBe(
      '/Users/tyler/Documents/Courses'
    )
    expect(teachingFolderFor('/Users/tyler/Lessons/a.pdf', folders)).toBe('/Users/tyler/Lessons/')
  })
  it('does not match a sibling folder that merely shares a prefix', () => {
    expect(teachingFolderFor('/Users/tyler/Documents/Courses-old/a.pdf', folders)).toBeNull()
    expect(teachingFolderFor('/Users/tyler/Documents/CoursesX', folders)).toBeNull()
  })
})

describe('isNoisePath', () => {
  const teaching = ['/Users/tyler/Library/Mobile Documents/com~apple~CloudDocs/Courses']
  it.each([
    ['/Users/tyler/Documents/.hidden/a.pdf', true],
    ['/Users/tyler/Documents/.DS_Store', true],
    ['/Users/tyler/Documents/~$Quiz.docx', true],
    ['/Users/tyler/Documents/Quiz.docx', false],
    ['/Users/tyler/Projects/app/node_modules/x/readme.md', true],
    ['/Applications/Word.app/Contents/x.pdf', true],
    ['/System/Library/x.pdf', true],
    ['/Library/Caches/x.pdf', true],
    ['/Users/tyler/Library/Caches/x.pdf', true],
    ['/Users/tyler/Library/Mail/x.pdf', true],
    ['/Users/tyler/Photos.photoslibrary/x.jpg', true],
    // iCloud Drive and other cloud storage sit under ~/Library but hold real teaching files.
    ['/Users/tyler/Library/Mobile Documents/com~apple~CloudDocs/Lesson.pdf', false],
    ['/Users/tyler/Library/CloudStorage/GoogleDrive-t@school.org/My Drive/Quiz.docx', false],
    ['/Users/tyler/Library/CloudStorage', false]
  ])('%s noisy=%s', (path, noisy) => expect(isNoisePath(path, HOME, [])).toBe(noisy))

  it('never filters inside a teaching folder (except hidden files)', () => {
    expect(isNoisePath(`${teaching[0]}/Unit 1/Quiz.pdf`, HOME, teaching)).toBe(false)
    expect(isNoisePath(`${teaching[0]}/.hidden/Quiz.pdf`, HOME, teaching)).toBe(true)
    expect(
      isNoisePath('/Users/tyler/Projects/node_modules/x.md', HOME, ['/Users/tyler/Projects'])
    ).toBe(false)
  })
})

describe('nameRank', () => {
  it('orders exact, prefix, word-start, contains, then content-only', () => {
    const words = ['unit', '3']
    expect(nameRank('unit 3.pdf', words)).toBe(0)
    expect(nameRank('Unit 3 quiz.pdf', words)).toBe(1)
    expect(nameRank('Bio Unit 3.pdf', words)).toBe(2)
    expect(nameRank('community 3.pdf', words)).toBe(3)
    expect(nameRank('notes.pdf', words)).toBe(4)
  })
  it('treats regex characters in the search literally', () => {
    expect(() => nameRank('a.pdf', ['(', '[a'])).not.toThrow()
    expect(nameRank('a (b).pdf', ['(b'])).toBeLessThan(4)
  })
})

interface FakeFile {
  size?: number
  mtimeMs?: number
  isFile?: boolean
}

function deps(over: {
  paths: Record<string, string[]>
  files?: Record<string, FakeFile>
  isMac?: boolean
  fail?: string[]
}) {
  const calls: { cmd: string; args: string[] }[] = []
  const exec: Exec = async (cmd, args) => {
    calls.push({ cmd, args })
    const key = args[0] === '-onlyin' ? args[1] : '*'
    if (over.fail?.includes(key)) throw Object.assign(new Error('mdfind failed'), { code: 'EFAIL' })
    return { stdout: (over.paths[key] ?? []).join('\n') + '\n', stderr: '' }
  }
  const d: SpotlightDeps = {
    exec,
    home: HOME,
    isMac: () => over.isMac ?? true,
    stat: async (p) => {
      const f = over.files?.[p]
      if (over.files && !f) return null
      return { isFile: f?.isFile ?? true, size: f?.size ?? 10, mtimeMs: f?.mtimeMs ?? 1000 }
    }
  }
  return { d, calls }
}

const Q = { text: 'unit 3', teachingOnly: false, includeContents: false }
const TEACH = ['/Users/tyler/Courses']

describe('searchFiles', () => {
  it('returns nothing for an empty query without calling Spotlight', async () => {
    const { d, calls } = deps({ paths: {} })
    expect(await searchFiles({ ...Q, text: '  ' }, TEACH, d)).toEqual({
      results: [],
      truncated: false
    })
    expect(calls).toHaveLength(0)
  })

  it('reports that search needs a Mac when it is not one', async () => {
    const { d, calls } = deps({ paths: {}, isMac: false })
    const res = await searchFiles(Q, TEACH, d)
    expect(res.unavailable).toMatch(/only works on a Mac/)
    expect(calls).toHaveLength(0)
  })

  it('ranks teaching-folder results first, even when other results match the name better', async () => {
    const { d } = deps({
      paths: {
        '/Users/tyler/Courses': ['/Users/tyler/Courses/Bio/old handout about unit 3 review.pdf'],
        '*': [
          '/Users/tyler/Downloads/Unit 3.pdf',
          '/Users/tyler/Courses/Bio/old handout about unit 3 review.pdf'
        ]
      }
    })
    const res = await searchFiles(Q, TEACH, d)
    expect(res.results.map((r) => r.path)).toEqual([
      '/Users/tyler/Courses/Bio/old handout about unit 3 review.pdf',
      '/Users/tyler/Downloads/Unit 3.pdf'
    ])
    expect(res.results.map((r) => r.isTeaching)).toEqual([true, false])
    expect(res.results[0].teachingFolder).toBe('/Users/tyler/Courses')
  })

  it('within a group, orders by name quality then most recently modified', async () => {
    const { d } = deps({
      paths: {
        '*': [
          '/x/a/Bio Unit 3.pdf',
          '/x/a/Unit 3 quiz.pdf',
          '/x/a/Unit 3 quiz old.pdf',
          '/x/a/unit 3.pdf'
        ]
      },
      files: {
        '/x/a/Bio Unit 3.pdf': { mtimeMs: 9000 },
        '/x/a/Unit 3 quiz.pdf': { mtimeMs: 1000 },
        '/x/a/Unit 3 quiz old.pdf': { mtimeMs: 5000 },
        '/x/a/unit 3.pdf': { mtimeMs: 100 }
      }
    })
    const res = await searchFiles(Q, [], d)
    expect(res.results.map((r) => r.name)).toEqual([
      'unit 3.pdf',
      'Unit 3 quiz old.pdf',
      'Unit 3 quiz.pdf',
      'Bio Unit 3.pdf'
    ])
  })

  it('teaching-only skips the whole-Mac search', async () => {
    const { d, calls } = deps({
      paths: { '/Users/tyler/Courses': ['/Users/tyler/Courses/Unit 3.pdf'] }
    })
    const res = await searchFiles({ ...Q, teachingOnly: true }, TEACH, d)
    expect(res.results).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].args.slice(0, 2)).toEqual(['-onlyin', '/Users/tyler/Courses'])
  })

  it('teaching-only with no folders explains what to do', async () => {
    const { d } = deps({ paths: {} })
    expect((await searchFiles({ ...Q, teachingOnly: true }, [], d)).unavailable).toMatch(
      /Add them in Settings/
    )
  })

  it('passes the query as one argument, never through a shell', async () => {
    const { d, calls } = deps({ paths: {} })
    await searchFiles({ ...Q, text: '$(rm -rf ~) `x` ; "quoted" && more' }, [], d)
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('mdfind')
    expect(calls[0].args).toHaveLength(1)
    expect(calls[0].args[0]).toContain('$(rm')
  })

  it('drops noise, folders, vanished files and duplicates', async () => {
    const { d } = deps({
      paths: {
        '/Users/tyler/Courses': [
          '/Users/tyler/Courses/Unit 3.pdf',
          '/Users/tyler/Courses/.cache/Unit 3.pdf'
        ],
        '*': [
          '/Users/tyler/Courses/Unit 3.pdf',
          '/Users/tyler/Library/Caches/Unit 3.pdf',
          '/Users/tyler/Documents/Unit 3 folder',
          '/Users/tyler/Documents/gone Unit 3.pdf',
          '/Users/tyler/Library/Mobile Documents/com~apple~CloudDocs/Unit 3 notes.pdf'
        ]
      },
      files: {
        '/Users/tyler/Courses/Unit 3.pdf': {},
        '/Users/tyler/Documents/Unit 3 folder': { isFile: false },
        '/Users/tyler/Library/Mobile Documents/com~apple~CloudDocs/Unit 3 notes.pdf': {}
      }
    })
    const res = await searchFiles(Q, TEACH, d)
    expect(res.results.map((r) => r.path)).toEqual([
      '/Users/tyler/Courses/Unit 3.pdf',
      '/Users/tyler/Library/Mobile Documents/com~apple~CloudDocs/Unit 3 notes.pdf'
    ])
  })

  it('still answers when one Spotlight run fails, and reports failure only if all do', async () => {
    const partial = deps({ paths: { '*': ['/x/Unit 3.pdf'] }, fail: ['/Users/tyler/Courses'] })
    expect((await searchFiles(Q, TEACH, partial.d)).results).toHaveLength(1)
    const all = deps({ paths: {}, fail: ['/Users/tyler/Courses', '*'] })
    const res = await searchFiles(Q, TEACH, all.d)
    expect(res.results).toEqual([])
    expect(res.unavailable).toMatch(/Spotlight search failed/)
  })

  it('reports a missing mdfind binary clearly', async () => {
    const d: SpotlightDeps = {
      exec: async () => {
        throw Object.assign(new Error('spawn mdfind ENOENT'), { code: 'ENOENT' })
      },
      home: HOME,
      isMac: () => true,
      stat: async () => null
    }
    expect((await searchFiles(Q, [], d)).unavailable).toBe('Spotlight (mdfind) was not found.')
  })

  it('respects the limit and reports truncation', async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `/x/Unit 3 ${i}.pdf`)
    const { d } = deps({ paths: { '*': paths } })
    const res = await searchFiles({ ...Q, limit: 10 }, [], d)
    expect(res.results).toHaveLength(10)
    expect(res.truncated).toBe(true)
  })

  it('classifies kinds and carries size and mtime through', async () => {
    const { d } = deps({
      paths: { '*': ['/x/Unit 3.docx'] },
      files: { '/x/Unit 3.docx': { size: 2048, mtimeMs: 123456 } }
    })
    const [r] = (await searchFiles(Q, [], d)).results
    expect(r).toMatchObject({
      name: 'Unit 3.docx',
      dir: '/x',
      kind: 'docx',
      size: 2048,
      mtime: 123456,
      isTeaching: false
    })
  })
})
