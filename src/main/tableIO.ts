import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

export type TableFormat = 'xlsx' | 'csv'

export interface ParsedTable {
  fileName: string
  sheetNames: string[]
  sheet: string | null
  rows: string[][]
}

/** Spreadsheet cells can hold numbers, dates, formulas, rich text and links; flatten to text. */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('richText' in v)
      return v.richText
        .map((r) => r.text)
        .join('')
        .trim()
    if ('result' in v) return v.result == null ? '' : cellText(v.result as ExcelJS.CellValue)
    if ('text' in v) return String(v.text).trim()
    if ('error' in v) return ''
    return ''
  }
  return String(v).trim()
}

const trimTrailingBlankRows = (rows: string[][]): string[][] => {
  let end = rows.length
  while (end > 0 && rows[end - 1].every((c) => c === '')) end--
  return rows.slice(0, end)
}

/** Reads a .xlsx, .csv, .tsv or .txt file into rows of text. `sheet` picks a worksheet in .xlsx. */
export async function readTable(path: string, sheet?: string | null): Promise<ParsedTable> {
  const ext = extname(path).toLowerCase()
  const fileName = basename(path)

  if (ext === '.xlsx' || ext === '.xlsm') {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(path)
    const sheetNames = wb.worksheets.map((w) => w.name)
    if (sheetNames.length === 0) return { fileName, sheetNames, sheet: null, rows: [] }
    const ws = (sheet ? wb.getWorksheet(sheet) : undefined) ?? wb.worksheets[0]
    const width = ws.actualColumnCount
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      // Preserve row positions so reported row numbers match what the teacher sees in Excel.
      while (rows.length < rowNumber - 1) rows.push(Array(width).fill(''))
      const out: string[] = []
      for (let c = 1; c <= width; c++) out.push(cellText(row.getCell(c).value))
      rows.push(out)
    })
    return { fileName, sheetNames, sheet: ws.name, rows: trimTrailingBlankRows(rows) }
  }

  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    // Trailing newlines make Papa's delimiter detection treat the last "row" as one field, which
    // defeats it for small files; trim them before parsing.
    const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '')
    const parsed = Papa.parse<string[]>(text, {
      delimiter: ext === '.tsv' ? '\t' : undefined,
      delimitersToGuess: [',', ';', '\t', '|'],
      skipEmptyLines: false
    })
    const rows = parsed.data.map((r) => r.map((c) => String(c ?? '').trim()))
    return { fileName, sheetNames: [], sheet: null, rows: trimTrailingBlankRows(rows) }
  }

  if (ext === '.xls')
    throw new Error(
      'Old .xls files are not supported. In Excel, choose Save As and pick .xlsx or .csv.'
    )
  throw new Error(`Unsupported file type "${ext || basename(path)}". Use .xlsx or .csv.`)
}

/**
 * A spreadsheet treats a leading = + - @ as a formula. Prefix text cells that start that way so
 * imported names or comments can never execute when someone opens the export.
 */
export function safeCell(v: string | number | null | undefined): string | number {
  if (v == null) return ''
  if (typeof v === 'number') return v
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

/** Excel forbids \\ / ? * [ ] : in sheet names, limits them to 31 characters and bars edge apostrophes. */
function worksheetName(name: string): string {
  const clean = name
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .slice(0, 31)
    .trim()
  return clean || 'Sheet1'
}

export type ExportCell = string | number | null | undefined

/** Writes rows to .xlsx or .csv. Numbers stay numbers so a spreadsheet can total them. */
export async function writeTable(
  path: string,
  rows: ExportCell[][],
  format: TableFormat,
  sheetName = 'Sheet1'
): Promise<void> {
  const safe = rows.map((r) => r.map(safeCell))
  if (format === 'csv') {
    // BOM so Excel opens UTF-8 names correctly.
    await writeFile(path, '\uFEFF' + Papa.unparse(safe, { newline: '\r\n' }), 'utf8')
    return
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(worksheetName(sheetName))
  safe.forEach((r) => ws.addRow(r))
  if (safe.length > 0) ws.getRow(1).font = { bold: true }
  ws.columns.forEach((col) => {
    let max = 8
    col.eachCell?.({ includeEmpty: false }, (c) => {
      max = Math.max(max, String(c.value ?? '').length + 2)
    })
    col.width = Math.min(max, 48)
  })
  await wb.xlsx.writeFile(path)
}
