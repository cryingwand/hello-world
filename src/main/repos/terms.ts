import type { TermInput } from '@shared/api'
import type { Term } from '@shared/models'
import * as v from '../validate'
import type { Db, Emit } from './types'

interface Row {
  id: number
  name: string
  start_date: string | null
  end_date: string | null
  is_current: number
}

const toTerm = (r: Row): Term => ({
  id: r.id,
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  isCurrent: r.is_current === 1
})

export function termsRepo(db: Db, emit: Emit) {
  const get = (id: number): Term | null => {
    const r = db.prepare('SELECT * FROM terms WHERE id = ?').get(id) as Row | undefined
    return r ? toTerm(r) : null
  }
  const must = (id: number): Term => {
    const t = get(id)
    if (!t) throw new v.ValidationError('That term no longer exists')
    return t
  }

  return {
    get,
    list(): Term[] {
      const rows = db
        .prepare("SELECT * FROM terms ORDER BY COALESCE(start_date, '') DESC, id DESC")
        .all() as Row[]
      return rows.map(toTerm)
    },
    create(input: TermInput): Term {
      const name = v.reqStr(input?.name, 'Term name')
      const start = v.dateOrNull(input.startDate, 'Start date')
      const end = v.dateOrNull(input.endDate, 'End date')
      if (start && end && end < start) throw new v.ValidationError('End date is before start date')
      const current = input.isCurrent ? 1 : 0
      const newId = db.transaction(() => {
        if (current) db.prepare('UPDATE terms SET is_current = 0').run()
        const res = db
          .prepare('INSERT INTO terms (name, start_date, end_date, is_current) VALUES (?, ?, ?, ?)')
          .run(name, start, end, current)
        return Number(res.lastInsertRowid)
      })()
      emit('terms.changed')
      return must(newId)
    },
    update(rawId: number, patch: Partial<TermInput>): Term {
      const id = v.id(rawId)
      const cur = must(id)
      const name = patch.name !== undefined ? v.reqStr(patch.name, 'Term name') : cur.name
      const start =
        patch.startDate !== undefined ? v.dateOrNull(patch.startDate, 'Start date') : cur.startDate
      const end =
        patch.endDate !== undefined ? v.dateOrNull(patch.endDate, 'End date') : cur.endDate
      if (start && end && end < start) throw new v.ValidationError('End date is before start date')
      const current =
        patch.isCurrent !== undefined ? (patch.isCurrent ? 1 : 0) : cur.isCurrent ? 1 : 0
      db.transaction(() => {
        if (current) db.prepare('UPDATE terms SET is_current = 0 WHERE id != ?').run(id)
        db.prepare(
          'UPDATE terms SET name = ?, start_date = ?, end_date = ?, is_current = ? WHERE id = ?'
        ).run(name, start, end, current, id)
      })()
      emit('terms.changed')
      return must(id)
    },
    delete(rawId: number): void {
      const id = v.id(rawId)
      const n = (
        db.prepare('SELECT COUNT(*) AS n FROM classes WHERE term_id = ?').get(id) as { n: number }
      ).n
      if (n > 0) {
        throw new v.ValidationError(
          `This term still has ${n} class${n === 1 ? '' : 'es'}. Delete or move them first.`
        )
      }
      db.transaction(() => {
        db.prepare("DELETE FROM file_links WHERE record_type = 'term' AND record_id = ?").run(id)
        db.prepare('DELETE FROM terms WHERE id = ?').run(id)
      })()
      emit('terms.changed')
    }
  }
}
