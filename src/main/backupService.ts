import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import type { BackupInfo } from '@shared/models'
import { listBackups, needsDailyBackup, runBackup } from './backup'
import type { Db } from './repos/types'

export interface BackupServiceDeps {
  dir: string
  publicDb: () => Db
  vault: {
    /** The open vault database, or null while it is locked. */
    open: () => Db | null
    dbPath: string
  }
  extraDir: () => string | null
  now?: () => Date
}

/**
 * Backs up both databases. The vault is backed up even while locked: this runs in the main process
 * and opens its own short-lived connection, so no passcode is involved and nothing is shown.
 */
export function createBackupService(deps: BackupServiceDeps) {
  const vaultBackup = async (now: Date): Promise<BackupInfo | null> => {
    const open = deps.vault.open()
    if (open)
      return runBackup(open, { dir: deps.dir, extraDir: deps.extraDir(), now, prefix: 'vault' })
    if (!existsSync(deps.vault.dbPath)) return null
    const temp = new Database(deps.vault.dbPath, { fileMustExist: true })
    try {
      return await runBackup(temp, {
        dir: deps.dir,
        extraDir: deps.extraDir(),
        now,
        prefix: 'vault'
      })
    } finally {
      temp.close()
    }
  }

  return {
    async runAll(): Promise<BackupInfo> {
      const now = deps.now?.() ?? new Date()
      const info = await runBackup(deps.publicDb(), {
        dir: deps.dir,
        extraDir: deps.extraDir(),
        now
      })
      try {
        const v = await vaultBackup(now)
        if (v) {
          info.vaultName = v.name
          if (v.extraError && !info.extraError) info.extraError = v.extraError
        }
      } catch (err) {
        // The public backup is already safe; report the vault problem instead of hiding it.
        info.vaultError = err instanceof Error ? err.message : String(err)
      }
      return info
    },

    list: (): BackupInfo[] => listBackups(deps.dir),
    listVault: (): BackupInfo[] => listBackups(deps.dir, 'vault'),

    /** True if either database has no backup yet today. */
    needsDaily(now: Date = deps.now?.() ?? new Date()): boolean {
      return (
        needsDailyBackup(deps.dir, now) ||
        (existsSync(deps.vault.dbPath) && needsDailyBackup(deps.dir, now, 'vault'))
      )
    }
  }
}

export type BackupService = ReturnType<typeof createBackupService>
