import ExcelJS from 'exceljs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readTable, safeCell, writeTable } from '../../src/main/tableIO'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'tos-table-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('readTable csv', () => {
  it('strips a BOM, handles quoted commas and newlines, and trims cells', async () => {
    const p = join(tmp(), 'r.csv')
    writeFileSync(p, '﻿Last,First,Notes\r\n"Lovelace, Jr.", Ada ,"line1\nline2"\r\n')
    const t = await readTable(p)
    expect(t.rows).toEqual([
      ['Last', 'First', 'Notes'],
      ['Lovelace, Jr.', 'Ada', 'line1\nline2']
    ])
    expect(t.sheetNames).toEqual([])
  })

  it('auto-detects semicolon delimiters and reads tsv', async () => {
    const d = tmp()
    writeFileSync(join(d, 'a.csv'), 'Last;First\nSmith;Sam\n')
    expect((await readTable(join(d, 'a.csv'))).rows[1]).toEqual(['Smith', 'Sam'])
    writeFileSync(join(d, 'b.tsv'), 'Last\tFirst\nSmith\tSam\n')
    expect((await readTable(join(d, 'b.tsv'))).rows[1]).toEqual(['Smith', 'Sam'])
  })

  it('drops trailing blank rows', async () => {
    const p = join(tmp(), 'r.csv')
    writeFileSync(p, 'A,B\n1,2\n,\n\n')
    expect((await readTable(p)).rows).toEqual([
      ['A', 'B'],
      ['1', '2']
    ])
  })
})

describe('readTable xlsx', () => {
  const build = async (path: string): Promise<void> => {
    const wb = new ExcelJS.Workbook()
    const a = wb.addWorksheet('Roster')
    a.addRow(['Report title'])
    a.addRow([])
    a.addRow(['Last', 'First', 'Grade', 'Enrolled', 'Total'])
    a.addRow([
      'Lovelace',
      'Ada',
      10,
      new Date(Date.UTC(2026, 8, 1)),
      { formula: 'C4*2', result: 20 }
    ])
    a.addRow([{ richText: [{ text: 'Tur' }, { text: 'ing' }] }, 'Alan', 11, null, null])
    wb.addWorksheet('Other').addRow(['x', 'y'])
    await wb.xlsx.writeFile(path)
  }

  it('flattens numbers, dates, formulas and rich text, and keeps sheet row positions', async () => {
    const p = join(tmp(), 'r.xlsx')
    await build(p)
    const t = await readTable(p)
    expect(t.sheetNames).toEqual(['Roster', 'Other'])
    expect(t.sheet).toBe('Roster')
    expect(t.rows[0]).toEqual(['Report title', '', '', '', ''])
    expect(t.rows[1]).toEqual(['', '', '', '', ''])
    expect(t.rows[2]).toEqual(['Last', 'First', 'Grade', 'Enrolled', 'Total'])
    expect(t.rows[3]).toEqual(['Lovelace', 'Ada', '10', '2026-09-01', '20'])
    expect(t.rows[4]).toEqual(['Turing', 'Alan', '11', '', ''])
  })

  it('reads a chosen sheet', async () => {
    const p = join(tmp(), 'r.xlsx')
    await build(p)
    const t = await readTable(p, 'Other')
    expect(t.sheet).toBe('Other')
    expect(t.rows).toEqual([['x', 'y']])
  })

  it('falls back to the first sheet for an unknown name', async () => {
    const p = join(tmp(), 'r.xlsx')
    await build(p)
    expect((await readTable(p, 'Nope')).sheet).toBe('Roster')
  })
})

describe('readTable errors', () => {
  it('explains legacy and unknown types', async () => {
    await expect(readTable('/x/old.xls')).rejects.toThrow(/Save As.*xlsx/)
    await expect(readTable('/x/doc.pdf')).rejects.toThrow(/Unsupported file type/)
  })
})

describe('writeTable', () => {
  const rows = [
    ['Last', 'Score', 'Note'],
    ['Lovelace', 92.5, '=HYPERLINK("http://evil")'],
    ['Turing', 88, '+1 555']
  ]

  it('round-trips through xlsx keeping numbers numeric, with formula text neutralised', async () => {
    const p = join(tmp(), 'out.xlsx')
    await writeTable(p, rows, 'xlsx', 'Grades')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(p)
    const ws = wb.getWorksheet('Grades')!
    expect(ws.getCell('B2').value).toBe(92.5)
    expect(typeof ws.getCell('B2').value).toBe('number')
    expect(ws.getCell('C2').value).toBe(`'=HYPERLINK("http://evil")`)
    expect(ws.getCell('C2').type).toBe(ExcelJS.ValueType.String)
    expect(ws.getRow(1).font?.bold).toBe(true)
  })

  it('round-trips through csv with a BOM, CRLF, quoting, and neutralised formulas', async () => {
    const p = join(tmp(), 'out.csv')
    await writeTable(
      p,
      [
        ['a,b', 'c"d'],
        ['=1+1', 5]
      ],
      'csv'
    )
    const raw = readFileSync(p, 'utf8')
    expect(raw.startsWith('﻿')).toBe(true)
    expect(raw).toContain('\r\n')
    const back = await readTable(p)
    expect(back.rows).toEqual([
      ['a,b', 'c"d'],
      ["'=1+1", '5']
    ])
  })

  it('sanitises worksheet names', async () => {
    const p = join(tmp(), 'out.xlsx')
    await writeTable(p, [['x']], 'xlsx', 'Bad/Name:With*Chars?[]')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(p)
    expect(wb.worksheets[0].name).toBe('Bad Name With Chars')
  })
})

describe('safeCell', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1', "'+1"],
    ['-2', "'-2"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
    ['Ada', 'Ada'],
    ['', '']
  ])('%j', (input, expected) => expect(safeCell(input)).toBe(expected))
  it('leaves numbers, including negatives, alone and blanks null', () => {
    expect(safeCell(-5)).toBe(-5)
    expect(safeCell(null)).toBe('')
    expect(safeCell(undefined)).toBe('')
  })
})
