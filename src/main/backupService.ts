import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import type { BackupInfo } from '@shared/models'
import { DEFAULT_KEEP_DAYS, listBackups, needsDailyBackup, pruneBackups, runBackup } from './backup'
import type { Db } from './repos/types'
import { pruneLegacyCopies } from './vault/legacy'

export interface BackupServiceDeps {
  dir: string
  publicDb: () => Db
  vault: {
    /** The open vault database, or null while it is locked. */
    open: () => Db | null
    dbPath: string
    /**
     * The extra folder for Vault backups, chosen inside the unlocked Vault (`vault.json`), or null
     * when that copy is off. Readable while locked, since backups run then too.
     */
    extraDir: () => string | null
  }
  /** The public extra folder (`settings.backupFolder`). It receives public backups only. */
  extraDir: () => string | null
  now?: () => Date
}

/** Shown in place of the real error, which names the Vault's folder and reaches the launcher. */
export const VAULT_EXTRA_ERROR = 'The Vault backup could not be copied to its extra folder.'

/**
 * Backs up both databases. The vault is backed up even while locked: this runs in the main process
 * and opens its own short-lived connection, so no passcode is involved and nothing is shown.
 *
 * The two extra folders are separate on purpose. The public one can be set from the launcher, which
 * needs no passcode, so it must never receive the vault: a vault copy goes only to the folder chosen
 * inside the Vault, and only when one is chosen.
 */
export function createBackupService(deps: BackupServiceDeps) {
  const vaultBackup = async (now: Date): Promise<BackupInfo | null> => {
    const opts = { dir: deps.dir, extraDir: deps.vault.extraDir(), now, prefix: 'vault' as const }
    const open = deps.vault.open()
    if (open) return runBackup(open, opts)
    if (!existsSync(deps.vault.dbPath)) return null
    const temp = new Database(deps.vault.dbPath, { fileMustExist: true })
    try {
      return await runBackup(temp, opts)
    } finally {
      temp.close()
    }
  }

  /**
   * Housekeeping that must not fail a backup: the pre-Vault copy of the old database is pruned like
   * any backup, and vault copies an earlier version left in the public extra folder age out by the
   * same 14-day rule instead of staying there forever.
   */
  const tidy = (now: Date): void => {
    try {
      pruneLegacyCopies(deps.dir, DEFAULT_KEEP_DAYS, now)
    } catch (err) {
      console.error('[backup] could not prune the pre-Vault copy:', err)
    }
    const extra = deps.extraDir()
    if (!extra) return
    try {
      pruneBackups(extra, DEFAULT_KEEP_DAYS, now, 'vault')
    } catch (err) {
      console.error('[backup] could not prune old vault copies in the extra folder:', err)
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
          if (v.extraError) {
            console.error(
              '[backup] copying the vault backup to its extra folder failed:',
              v.extraError
            )
            info.vaultExtraError = VAULT_EXTRA_ERROR
          }
        }
      } catch (err) {
        // The public backup is already safe; report the vault problem instead of hiding it.
        info.vaultError = err instanceof Error ? err.message : String(err)
      }
      tidy(now)
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
