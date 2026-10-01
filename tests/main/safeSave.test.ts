import { describe, expect, it } from 'vitest'
import { createSafeSave } from '../../src/main/safeSave'

function setup(folders: string[], answers: (string | null)[], confirm: boolean[] = []) {
  const shownAt: string[] = []
  const asked: string[] = []
  const wrap = createSafeSave({
    folders: () => folders,
    isProtected: async (p) => folders.some((f) => p === f || p.startsWith(`${f}/`)),
    confirmOutside: async (p) => {
      asked.push(p)
      return confirm.shift() ?? false
    }
  })
  const pick = wrap(async (defaultPath: string, format: string) => {
    shownAt.push(`${defaultPath} [${format}]`)
    return answers.shift() ?? null
  })
  return { pick, shownAt, asked }
}

describe('createSafeSave', () => {
  it('opens in the first protected folder and saves there without asking', async () => {
    const { pick, shownAt, asked } = setup(['/Exams'], ['/Exams/Bio/Quiz 3.docx'])
    expect(await pick('Quiz 3.docx', 'docx')).toBe('/Exams/Bio/Quiz 3.docx')
    expect(shownAt).toEqual(['/Exams/Quiz 3.docx [docx]'])
    expect(asked).toEqual([])
  })

  it('remembers the protected folder last saved to', async () => {
    const { pick, shownAt } = setup(['/Exams', '/Grades'], ['/Grades/2026/a.xlsx', null])
    await pick('a.xlsx', 'xlsx')
    await pick('b.xlsx', 'xlsx')
    expect(shownAt[1]).toBe('/Grades/2026/b.xlsx [xlsx]')
  })

  it('asks before saving outside, and opens the dialog again when declined', async () => {
    const { pick, shownAt, asked } = setup(
      ['/Exams'],
      ['/Users/t/Downloads/key.docx', '/Users/t/Desktop/key.docx'],
      [false, true]
    )
    expect(await pick('key.docx', 'docx')).toBe('/Users/t/Desktop/key.docx')
    expect(asked).toEqual(['/Users/t/Downloads/key.docx', '/Users/t/Desktop/key.docx'])
    expect(shownAt).toEqual(['/Exams/key.docx [docx]', '/Exams/key.docx [docx]'])
  })

  it('cancelling returns null', async () => {
    const { pick } = setup(['/Exams'], [null])
    expect(await pick('x.docx', 'docx')).toBeNull()
  })

  it('behaves like a plain dialog when nothing is protected', async () => {
    const { pick, shownAt, asked } = setup([], ['/Users/t/Downloads/x.docx'])
    expect(await pick('x.docx', 'docx')).toBe('/Users/t/Downloads/x.docx')
    expect(shownAt).toEqual(['x.docx [docx]'])
    expect(asked).toEqual([])
  })
})
