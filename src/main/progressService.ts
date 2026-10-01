import {
  planProgressImport,
  type ProgressImportPlan,
  type ProgressImportRequest,
  type ProgressImportResult
} from '@shared/progressImport'
import type { Repositories } from './repos'
import { readTable } from './tableIO'
import type { TokenStore } from './tokens'
import * as v from './validate'

const MAX_COLUMN = 1000
const MAPPED = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'course',
  'grade',
  'term',
  'source',
  'recordedOn'
] as const

/** Imports grades earned elsewhere from a spreadsheet the teacher picked, for advisees only. */
export function createProgressService(repos: Repositories, tokens: TokenStore) {
  const checkRequest = (req: ProgressImportRequest): void => {
    if (!req || typeof req !== 'object') throw new v.ValidationError('Nothing to import')
    if (typeof req.hasHeader !== 'boolean') {
      throw new v.ValidationError('hasHeader must be true or false')
    }
    const m = req.mapping
    if (!m || typeof m !== 'object') throw new v.ValidationError('Choose which columns to import')
    for (const key of MAPPED) {
      const i = m[key]
      if (i !== null && (!Number.isInteger(i) || i < 0 || i > MAX_COLUMN)) {
        throw new v.ValidationError(`Bad column for ${key}`)
      }
    }
    if (m.firstName === null && m.lastName === null && m.fullName === null && m.email === null) {
      throw new v.ValidationError('Choose the column that identifies each student (name or email)')
    }
    if (m.course === null) throw new v.ValidationError('Choose the column that holds the course')
    if (m.grade === null) throw new v.ValidationError('Choose the column that holds the grade')
    const d = req.defaults
    if (!d || typeof d !== 'object') throw new v.ValidationError('Missing defaults')
    v.optStr(d.term, 'Term', 100)
    v.optStr(d.source, 'Source', 200)
    v.dateOrNull(d.recordedOn, 'Date')
  }

  const plan = async (req: ProgressImportRequest): Promise<ProgressImportPlan> => {
    checkRequest(req)
    const table = await readTable(tokens.get(req.token), req.sheet)
    const advisees = repos.advising.advisees().map((a) => a.student)
    const existing = advisees.flatMap((s) => repos.advising.progress(s.id))
    return planProgressImport(
      table.rows,
      req.hasHeader,
      req.mapping,
      {
        term: v.optStr(req.defaults.term, 'Term', 100),
        source: v.optStr(req.defaults.source, 'Source', 200),
        recordedOn: v.dateOrNull(req.defaults.recordedOn, 'Date')
      },
      advisees,
      existing
    )
  }

  return {
    async previewImport(req: ProgressImportRequest): Promise<ProgressImportPlan> {
      return plan(req)
    },

    /** Re-plans from the file, never trusting a plan from the renderer, and applies it all-or-nothing. */
    async commitImport(req: ProgressImportRequest): Promise<ProgressImportResult> {
      const p = await plan(req)
      if (p.counts.create + p.counts.update === 0) {
        throw new v.ValidationError('There is nothing new to import from this file')
      }
      repos.transaction(() => {
        for (const row of p.rows) {
          if (!row.entry || row.studentId === null) continue
          if (row.action === 'create') {
            repos.advising.createProgress({ studentId: row.studentId, ...row.entry })
          } else if (row.action === 'update' && row.existingId !== undefined) {
            repos.advising.updateProgress(row.existingId, row.entry)
          }
        }
      })
      return {
        created: p.counts.create,
        updated: p.counts.update,
        unchanged: p.counts.unchanged,
        skipped: p.counts.unmatched + p.counts.duplicate + p.counts.invalid
      }
    }
  }
}

export type ProgressService = ReturnType<typeof createProgressService>
