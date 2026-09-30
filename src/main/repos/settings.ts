import { isAbsolute } from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/models'
import * as v from '../validate'
import type { Db, Emit } from './types'

export function settingsRepo(db: Db, emit: Emit) {
  const read = (): AppSettings => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const stored: Record<string, unknown> = {}
    for (const r of rows) {
      try {
        stored[r.key] = JSON.parse(r.value)
      } catch {
        // A corrupt value falls back to its default rather than breaking startup.
      }
    }
    // Only the named settings are returned: the same table also holds the protected folder list,
    // which must never travel to a window outside the vault.
    return {
      teachingFolders: Array.isArray(stored.teachingFolders)
        ? (stored.teachingFolders as string[])
        : DEFAULT_SETTINGS.teachingFolders,
      backupFolder:
        typeof stored.backupFolder === 'string' || stored.backupFolder === null
          ? (stored.backupFolder as string | null)
          : DEFAULT_SETTINGS.backupFolder,
      presentation: {
        ...DEFAULT_SETTINGS.presentation,
        ...((stored.presentation as Partial<AppSettings['presentation']>) ?? {})
      }
    }
  }
  const write = (key: keyof AppSettings, value: unknown): void => {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    ).run(key, JSON.stringify(value))
  }

  return {
    get: read,
    update(patch: Partial<AppSettings>): AppSettings {
      const clean: Partial<AppSettings> = {}
      if (patch.teachingFolders !== undefined) {
        if (!Array.isArray(patch.teachingFolders))
          throw new v.ValidationError('teachingFolders must be a list')
        const folders = patch.teachingFolders.map((f) => v.reqStr(f, 'Folder', 1024))
        for (const f of folders)
          if (!isAbsolute(f)) throw new v.ValidationError('Folders must be absolute paths')
        clean.teachingFolders = [...new Set(folders.map((f) => f.replace(/\/+$/, '') || '/'))]
      }
      if (patch.backupFolder !== undefined) {
        if (patch.backupFolder === null) clean.backupFolder = null
        else {
          const f = v.reqStr(patch.backupFolder, 'Backup folder', 1024)
          if (!isAbsolute(f)) throw new v.ValidationError('Backup folder must be an absolute path')
          clean.backupFolder = f
        }
      }
      if (patch.presentation !== undefined) {
        const p = patch.presentation as Partial<AppSettings['presentation']>
        if (
          p.offerOnExternalDisplay !== undefined &&
          typeof p.offerOnExternalDisplay !== 'boolean'
        ) {
          throw new v.ValidationError('offerOnExternalDisplay must be true or false')
        }
        clean.presentation = { ...read().presentation, ...p }
      }
      db.transaction(() => {
        for (const [k, val] of Object.entries(clean)) write(k as keyof AppSettings, val)
      })()
      emit('settings.changed')
      return read()
    }
  }
}
