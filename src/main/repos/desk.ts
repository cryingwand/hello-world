import type { Db, Emit } from './types'

export interface DeskRow {
  id: number
  kind: 'file' | 'folder' | 'area'
  path: string | null
  label: string
  color: string
  x: number
  y: number
  w: number
  h: number
}

/** The everyday desktop's arrangement. Only `deskService` calls this; it checks paths first. */
export function deskRepo(db: Db, emit: Emit) {
  const get = (id: number): DeskRow | null =>
    (db.prepare('SELECT * FROM desk_items WHERE id = ?').get(id) as DeskRow | undefined) ?? null
  return {
    get,
    /** Areas first, so they sit under the files placed on them. */
    list(): DeskRow[] {
      return db.prepare("SELECT * FROM desk_items ORDER BY kind != 'area', id").all() as DeskRow[]
    },
    count(): number {
      return (db.prepare('SELECT COUNT(*) AS n FROM desk_items').get() as { n: number }).n
    },
    insert(row: Omit<DeskRow, 'id'>): DeskRow {
      const res = db
        .prepare(
          'INSERT INTO desk_items (kind, path, label, color, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(row.kind, row.path, row.label, row.color, row.x, row.y, row.w, row.h)
      emit('desk.changed')
      return get(Number(res.lastInsertRowid))!
    },
    /** Several items at once (an area moved with what is on it), in one transaction. */
    update(rows: Pick<DeskRow, 'id' | 'label' | 'color' | 'x' | 'y' | 'w' | 'h'>[]): void {
      const set = db.prepare(
        'UPDATE desk_items SET label = ?, color = ?, x = ?, y = ?, w = ?, h = ? WHERE id = ?'
      )
      db.transaction(() => {
        for (const r of rows) set.run(r.label, r.color, r.x, r.y, r.w, r.h, r.id)
      })()
      emit('desk.changed')
    },
    /**
     * A file or folder was renamed or moved: its pin, and the pins of anything inside it, follow.
     * A pin's label is the file's name, so the renamed one's label changes too.
     */
    repath(from: string, to: string): void {
      const under = `${from}/`
      const res = db.transaction(() => {
        const n = db
          .prepare(
            `UPDATE desk_items SET path = ? || substr(path, ?)
             WHERE kind != 'area' AND substr(path, 1, ?) = ?`
          )
          .run(to, from.length + 1, under.length, under).changes
        const self = db
          .prepare("UPDATE desk_items SET path = ?, label = ? WHERE kind != 'area' AND path = ?")
          .run(to, to.slice(to.lastIndexOf('/') + 1), from).changes
        return n + self
      })()
      if (res > 0) emit('desk.changed')
    },
    remove(id: number): void {
      db.prepare('DELETE FROM desk_items WHERE id = ?').run(id)
      emit('desk.changed')
    }
  }
}
