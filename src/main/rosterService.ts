import type { ImportRequest, ImportPreview, ImportResult, TableFile } from '@shared/roster'
import {
  IMPORT_FIELDS,
  countPlans,
  planImport,
  rosterExportRows,
  type ImportMapping,
  type ImportRowPlan
} from '@shared/roster'
import { readTable, writeTable, type TableFormat } from './tableIO'
import type { Repositories } from './repos'
import { createTokenStore, type TokenStore } from './tokens'
import * as v from './validate'

export interface RosterDeps {
  pickOpenFile: () => Promise<string | null>
  pickSaveFile: (defaultName: string, format: TableFormat) => Promise<string | null>
}

export const safeName = (s: string): string =>
  s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Roster'

export function createRosterService(
  repos: Repositories,
  deps: RosterDeps,
  tokens: TokenStore = createTokenStore()
) {
  // Tokens stand in for file paths so the renderer never handles a path it did not pick itself.
  const remember = tokens.remember
  const pathFor = tokens.get

  const checkMapping = (mapping: ImportMapping, hasHeader: unknown): void => {
    if (typeof hasHeader !== 'boolean')
      throw new v.ValidationError('hasHeader must be true or false')
    if (!mapping || typeof mapping !== 'object')
      throw new v.ValidationError('Choose which columns hold names')
    for (const f of IMPORT_FIELDS) {
      const i = mapping[f]
      if (i !== null && (!Number.isInteger(i) || i < 0 || i > 500))
        throw new v.ValidationError(`Bad column for ${f}`)
    }
    if (mapping.firstName === null && mapping.lastName === null && mapping.fullName === null) {
      throw new v.ValidationError('Choose the column that holds student names')
    }
  }

  const plan = async (
    req: ImportRequest
  ): Promise<{ plans: ImportRowPlan[]; table: TableFile }> => {
    checkMapping(req?.mapping, req?.hasHeader)
    const path = pathFor(req.token)
    const parsed = await readTable(path, req.sheet)
    const table: TableFile = { token: req.token, ...parsed }
    const enrolled =
      'classId' in req.target
        ? new Set(repos.classes.roster(v.id(req.target.classId, 'classId')).map((s) => s.id))
        : new Set<number>()
    const plans = planImport(
      table.rows,
      req.hasHeader,
      req.mapping,
      repos.students.list(),
      enrolled
    )
    return { plans, table }
  }

  return {
    tokens,
    async chooseFile(): Promise<TableFile | null> {
      const path = await deps.pickOpenFile()
      if (!path) return null
      const parsed = await readTable(path)
      return { token: remember(path), ...parsed }
    },

    async readSheet(token: string, sheet: string): Promise<TableFile> {
      const parsed = await readTable(pathFor(token), sheet)
      return { token, ...parsed }
    },

    async preview(req: ImportRequest): Promise<ImportPreview> {
      if ('classId' in req.target) v.id(req.target.classId, 'classId')
      const { plans } = await plan(req)
      return { rows: plans, counts: countPlans(plans) }
    },

    /** Re-plans from the file (never trusts a plan sent by the renderer) and applies it all-or-nothing. */
    async commit(req: ImportRequest): Promise<ImportResult> {
      const { plans } = await plan(req)
      const counts = countPlans(plans)
      if (counts.create + counts.enrollExisting === 0) {
        throw new v.ValidationError('There is nothing new to import from this file')
      }
      let classId = 0
      repos.transaction(() => {
        classId =
          'classId' in req.target
            ? v.id(req.target.classId, 'classId')
            : repos.classes.create(req.target.newClass).id
        if (!repos.classes.get(classId)) throw new v.ValidationError('That class no longer exists')
        for (const p of plans) {
          if (p.action === 'create' && p.student) {
            const s = repos.students.create(p.student)
            repos.classes.enroll(classId, s.id)
          } else if (p.action === 'enroll-existing' && p.matchedStudentId !== undefined) {
            repos.classes.enroll(classId, p.matchedStudentId)
          }
        }
      })
      return {
        classId,
        created: counts.create,
        enrolledExisting: counts.enrollExisting,
        skipped: counts.alreadyEnrolled + counts.duplicate + counts.invalid
      }
    },

    async exportClass(rawClassId: number, format: TableFormat): Promise<{ path: string } | null> {
      const classId = v.id(rawClassId, 'classId')
      const format_ = v.oneOf(format, ['xlsx', 'csv'] as const, 'Format')
      const cls = repos.classes.get(classId)
      if (!cls) throw new v.ValidationError('That class no longer exists')
      const label = [
        cls.course,
        cls.section && `Section ${cls.section}`,
        cls.period && `Period ${cls.period}`
      ]
        .filter(Boolean)
        .join(' ')
      const path = await deps.pickSaveFile(`${safeName(label)} roster.${format_}`, format_)
      if (!path) return null
      await writeTable(path, rosterExportRows(repos.classes.roster(classId)), format_, 'Roster')
      return { path }
    }
  }
}

export type RosterService = ReturnType<typeof createRosterService>
