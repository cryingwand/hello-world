import { studentDisplayName } from '@shared/advising'
import type { Student } from '@shared/models'

export function classLabel(c: { course: string; section: string; period: string }): string {
  return [c.course, c.section && `Sec ${c.section}`, c.period && `P${c.period}`]
    .filter(Boolean)
    .join(' · ')
}

/** "Last, First" with the preferred name in quotes when set. */
export function studentName(s: Pick<Student, 'firstName' | 'lastName' | 'preferredName'>): string {
  const base = [s.lastName, s.firstName].filter(Boolean).join(', ')
  return s.preferredName ? `${base} "${s.preferredName}"` : base
}

/** "First Last", using the preferred name when set. For text written to someone, not for sorting. */
export const fullName: (s: Pick<Student, 'firstName' | 'lastName' | 'preferredName'>) => string =
  studentDisplayName

/** Spreadsheet-style column letters: 0 -> A, 26 -> AA. */
export function columnLetter(i: number): string {
  let n = i
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}
