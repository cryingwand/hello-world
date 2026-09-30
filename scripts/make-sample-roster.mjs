// Writes a FAKE roster (invented names, example.org emails) for trying the importer.
// Usage: node scripts/make-sample-roster.mjs [outDir]
import ExcelJS from 'exceljs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'samples'
mkdirSync(outDir, { recursive: true })

const students = [
  ['Abernathy', 'Priya', 'Pri', 'priya.abernathy@example.org'],
  ['Bellweather', 'Tomas', '', 'tomas.bellweather@example.org'],
  ['Castellanos', 'Wren', '', 'wren.castellanos@example.org'],
  ['Devereaux', 'Marisol', 'Mari', 'marisol.devereaux@example.org'],
  ['Eastwood', 'Jun', '', 'jun.eastwood@example.org'],
  ['Fairchild', 'Odalys', '', 'odalys.fairchild@example.org'],
  ['Grantham', 'Ezekiel', 'Zeke', 'ezekiel.grantham@example.org'],
  ['Holloway', 'Ingrid', '', 'ingrid.holloway@example.org'],
  ['Ito', 'Basil', '', 'basil.ito@example.org'],
  ['Jankowski', 'Noor', '', 'noor.jankowski@example.org']
]

const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('Period 3')
ws.addRow(['Student ID', 'Last Name', 'First Name', 'Preferred Name', 'Student Email', 'Grade'])
students.forEach(([last, first, pref, email], i) =>
  ws.addRow([100200 + i, last, first, pref, email, 10])
)
await wb.xlsx.writeFile(join(outDir, 'sample-roster.xlsx'))
console.log(`Wrote ${join(outDir, 'sample-roster.xlsx')} (${students.length} fake students)`)
