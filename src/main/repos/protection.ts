import { isAbsolute, resolve, sep } from 'node:path'
import * as v from '../validate'
import type { Db, Emit } from './types'

const KEY = 'protectedFolders'

/** Lower-cased for comparison: on a Mac's default disk two spellings can be the same folder. */
const same = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()
const within = (path: string, folder: string): boolean => {
  const p = path.normalize('NFC').toLowerCase()
  const f = folder.normalize('NFC').toLowerCase()
  return p === f || p.startsWith(f.endsWith(sep) ? f : f + sep)
}

/**
 * The folders whose files are kept inside the Vault. They are stored in the everyday database, not
 * the vault's, because they must still apply while the vault is locked (a locked vault must not make
 * protected files show up in search). Only the unlocked vault can read or change the list.
 */
export function protectionRepo(db: Db, emit: Emit) {
  const read = (): string[] => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as
      { value: string } | undefined
    if (!row) return []
    try {
      const parsed = JSON.parse(row.value) as unknown
      return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : []
    } catch {
      return []
    }
  }
  const write = (folders: string[]): void => {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    ).run(KEY, JSON.stringify(folders))
    emit('protection.changed')
  }

  return {
    list: read,

    add(raw: unknown): string[] {
      const given = v.reqStr(raw, 'Folder', 1024)
      if (given.includes('\0') || !isAbsolute(given))
        throw new v.ValidationError('Choose a folder on this Mac')
      const folder = resolve(given)
      if (folder === sep) throw new v.ValidationError('Choose a folder, not the whole disk')
      const current = read()
      if (current.some((f) => same(f, folder))) return current
      const parent = current.find((f) => within(folder, f))
      if (parent) throw new v.ValidationError(`That folder is already protected through ${parent}`)
      // A new folder that holds existing ones replaces them, so the list has no overlaps.
      const next = [...current.filter((f) => !within(f, folder)), folder]
      write(next)
      return next
    },

    remove(raw: unknown): string[] {
      const path = v.reqStr(raw, 'Folder', 1024)
      const current = read()
      const next = current.filter((f) => f !== path)
      if (next.length === current.length) return current
      write(next)
      return next
    }
  }
}
