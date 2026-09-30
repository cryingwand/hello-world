import type { ScoreImportPlan, ScoreImportRequest, ScoreImportResult } from '@shared/scoreImport'
import { planScoreImport, scoreDetailRows, scoreExportRows } from '@shared/scoreImport'
import type { Repositories } from './repos'
import { safeName } from './rosterService'
import { readTable, writeTable, writeWorkbook, type TableFormat } from './tableIO'
import type { TokenStore } from './tokens'
import * as v from './validate'

export interface ScoreDeps {
  pickSaveFile: (defaultName: string, format: TableFormat) => Promise<string | null>
}

const MAX_COLUMNS = 300

export function createScoreService(repos: Repositories, tokens: TokenStore, deps: ScoreDeps) {
  const checkRequest = (req: ScoreImportRequest): void => {
    if (!req || typeof req !== 'object') throw new v.ValidationError('Nothing to import')
    v.id(req.classId, 'classId')
    if (typeof req.hasHeader !== 'boolean' || typeof req.pointsRow !== 'boolean') {
      throw new v.ValidationError('hasHeader and pointsRow must be true or false')
    }
    const m = req.mapping
    if (!m || !Array.isArray(m.columns))
      throw new v.ValidationError('Choose which columns hold scores')
    if (m.columns.length === 0) throw new v.ValidationError('Choose at least one column of scores')
    if (m.columns.length > MAX_COLUMNS)
      throw new v.ValidationError('That is too many columns to import at once')
    for (const key of ['firstName', 'lastName', 'fullName', 'email'] as const) {
      const i = m[key]
      if (i !== null && (!Number.isInteger(i) || i < 0 || i > 1000))
        throw new v.ValidationError(`Bad column for ${key}`)
    }
    if (m.firstName === null && m.lastName === null && m.fullName === null && m.email === null) {
      throw new v.ValidationError('Choose the column that identifies each student (name or email)')
    }
    const seen = new Set<string>()
    for (const c of m.columns) {
      if (!Number.isInteger(c.index) || c.index < 0 || c.index > 1000)
        throw new v.ValidationError('Bad score column')
      const title = v.reqStr(c.title, 'Assignment name', 200)
      v.num(c.pointsPossible, `Points possible for ${title}`, 0)
      if (c.categoryId !== null) v.id(c.categoryId, 'Category')
      const key = title.toLowerCase().replace(/\s+/g, ' ')
      if (seen.has(key))
        throw new v.ValidationError(`Two columns are both called "${title}". Rename one.`)
      seen.add(key)
    }
  }

  const plan = async (req: ScoreImportRequest): Promise<ScoreImportPlan> => {
    checkRequest(req)
    if (!repos.classes.get(req.classId)) throw new v.ValidationError('That class no longer exists')
    const table = await readTable(tokens.get(req.token), req.sheet)
    return planScoreImport(
      table.rows,
      req.hasHeader,
      req.pointsRow,
      req.mapping,
      repos.classes.roster(req.classId),
      repos.grading.assignments(req.classId),
      repos.grading.scores(req.classId)
    )
  }

  return {
    async previewScores(req: ScoreImportRequest): Promise<ScoreImportPlan> {
      return plan(req)
    },

    /** Re-plans from the file and applies it all-or-nothing: new assignments, then the scores. */
    async commitScores(req: ScoreImportRequest): Promise<ScoreImportResult> {
      const p = await plan(req)
      if (p.counts.scoresToWrite === 0 && p.counts.newAssignments === 0) {
        throw new v.ValidationError('There is nothing new to import from this file')
      }
      const previous = new Map(
        repos.grading.scores(req.classId).map((s) => [`${s.assignmentId}:${s.studentId}`, s])
      )
      repos.transaction(() => {
        const ids = p.assignments.map(
          (a, i) =>
            a.existingId ??
            repos.grading.createAssignment({
              classId: req.classId,
              categoryId: req.mapping.columns[i].categoryId,
              title: a.title,
              pointsPossible: a.pointsPossible
            }).id
        )
        const inputs = p.changes
          .filter((c) => !c.unchanged)
          .map((c) => ({
            assignmentId: ids[c.column],
            studentId: c.studentId,
            points: c.points,
            status: c.status,
            // Importing numbers must not wipe a teacher's comment on that score.
            comment: previous.get(`${ids[c.column]}:${c.studentId}`)?.comment ?? ''
          }))
        repos.grading.setScores(inputs)
      })
      return {
        createdAssignments: p.counts.newAssignments,
        scoresWritten: p.counts.scoresToWrite,
        unchanged: p.counts.unchanged,
        skippedRows: p.counts.unmatchedStudents,
        invalidCells: p.counts.invalidCells
      }
    },

    async exportClass(rawClassId: number, format: TableFormat): Promise<{ path: string } | null> {
      const classId = v.id(rawClassId, 'classId')
      const fmt = v.oneOf(format, ['xlsx', 'csv'] as const, 'Format')
      const cls = repos.classes.get(classId)
      if (!cls) throw new v.ValidationError('That class no longer exists')
      const students = repos.classes.roster(classId)
      const assignments = repos.grading.assignments(classId)
      const categories = repos.grading.categories(classId)
      const scores = repos.grading.scores(classId)

      const label = [
        cls.course,
        cls.section && `Section ${cls.section}`,
        cls.period && `Period ${cls.period}`
      ]
        .filter(Boolean)
        .join(' ')
      const path = await deps.pickSaveFile(`${safeName(label)} gradebook.${fmt}`, fmt)
      if (!path) return null

      const rows = scoreExportRows(cls.gradingMode, students, assignments, categories, scores)
      if (fmt === 'csv') {
        await writeTable(path, rows, 'csv')
      } else {
        const details = scoreDetailRows(students, assignments, scores)
        await writeWorkbook(path, [
          { name: 'Scores', rows },
          ...(details.length > 1 ? [{ name: 'Details', rows: details }] : [])
        ])
      }
      return { path }
    }
  }
}

export type ScoreService = ReturnType<typeof createScoreService>
