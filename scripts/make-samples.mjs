// Writes FAKE sample files (invented names, example.org emails) for trying the importers:
//   samples/sample-roster.xlsx           a class roster
//   samples/sample-gradebook-export.xlsx a school-system style score export for the same students
// Usage: node scripts/make-samples.mjs [outDir]
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

// --- roster
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Period 3')
  ws.addRow(['Student ID', 'Last Name', 'First Name', 'Preferred Name', 'Student Email', 'Grade'])
  students.forEach(([last, first, pref, email], i) =>
    ws.addRow([100200 + i, last, first, pref, email, 10])
  )
  await wb.xlsx.writeFile(join(outDir, 'sample-roster.xlsx'))
}

// --- score export, the way many school systems lay it out: points possible in the header text,
// M for missing, EX for excused, blanks for not yet graded, and summary columns to ignore.
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Scores')
  ws.addRow([
    'Student ID',
    'Last Name',
    'First Name',
    'Student Email',
    'Quiz 1 (20)',
    'Essay [50]',
    'HW 1 /10',
    'Lab - 15 pts',
    'Unit Test',
    'Total',
    'Current Grade'
  ])
  const rows = [
    [18, 45, 10, 'M', 88],
    [15.5, 'EX', '', 12, 75],
    [20, 50, 9, 15, 92],
    [12, 30, 7, 9, 61],
    [17, 41, 10, 14, ''],
    ['M', 38, 8, 11, 70],
    [19, 47, 10, 15, 96],
    [14, 'EX', 6, 10, 58],
    [16, 40, 9, 12, 81],
    [11, 33, '', 8, 64]
  ]
  students.forEach(([last, first, , email], i) => {
    const r = rows[i]
    const earned = r.filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0)
    ws.addRow([
      100200 + i,
      last,
      first,
      email,
      ...r,
      earned,
      `${Math.round((earned / 195) * 1000) / 10}%`
    ])
  })
  await wb.xlsx.writeFile(join(outDir, 'sample-gradebook-export.xlsx'))
}
console.log(
  `Wrote ${join(outDir, 'sample-roster.xlsx')} and ${join(outDir, 'sample-gradebook-export.xlsx')} (${students.length} fake students)`
)
