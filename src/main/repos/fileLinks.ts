import { isAbsolute } from 'node:path'
import type { FileLinkInput } from '@shared/api'
import type { FileLink, LinkRecordType } from '@shared/models'
import * as v from '../validate'
import type { Db, Emit } from './types'

interface Row {
  id: number
  path: string
  record_type: LinkRecordType
  record_id: number
  created_at: string
}
const toLink = (r: Row): FileLink => ({
  id: r.id,
  path: r.path,
  recordType: r.record_type,
  recordId: r.record_id,
  createdAt: r.created_at
})

const TABLE: Record<LinkRecordType, string> = {
  student: 'students',
  class: 'classes',
  term: 'terms',
  unit: 'units',
  lesson: 'lessons'
}
const RECORD_TYPES = Object.keys(TABLE) as LinkRecordType[]

export function fileLinksRepo(db: Db, emit: Emit) {
  return {
    list(recordType: LinkRecordType, rawId: number): FileLink[] {
      const type = v.oneOf(recordType, RECORD_TYPES, 'Record type')
      const rows = db
        .prepare('SELECT * FROM file_links WHERE record_type = ? AND record_id = ? ORDER BY id')
        .all(type, v.id(rawId, 'recordId')) as Row[]
      return rows.map(toLink)
    },
    add(input: FileLinkInput): FileLink {
      const type = v.oneOf(input?.recordType, RECORD_TYPES, 'Record type')
      const recordId = v.id(input.recordId, 'recordId')
      const path = v.reqStr(input.path, 'Path', 1024)
      if (!isAbsolute(path)) throw new v.ValidationError('Path must be absolute')
      if (!db.prepare(`SELECT 1 FROM ${TABLE[type]} WHERE id = ?`).get(recordId)) {
        throw new v.ValidationError(`That ${type} no longer exists`)
      }
      db.prepare(
        'INSERT OR IGNORE INTO file_links (path, record_type, record_id) VALUES (?, ?, ?)'
      ).run(path, type, recordId)
      const row = db
        .prepare('SELECT * FROM file_links WHERE path = ? AND record_type = ? AND record_id = ?')
        .get(path, type, recordId) as Row
      emit('fileLinks.changed')
      return toLink(row)
    },
    remove(rawId: number): void {
      db.prepare('DELETE FROM file_links WHERE id = ?').run(v.id(rawId))
      emit('fileLinks.changed')
    }
  }
}
