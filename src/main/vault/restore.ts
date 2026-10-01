import Database from 'better-sqlite3'
import { copyFileSync, rmSync } from 'node:fs'
import type { BackupInfo } from '@shared/models'
import type { BackupService } from '../backupService'
import { assertSoundDatabase } from '../backup'
import { VAULT_MIGRATIONS, latestVersion } from '../db/migrations'
import * as v from '../validate'

export interface VaultRestoreDeps {
  backups: Pick<BackupService, 'listVault' | 'vaultNow'>
  /** Where the chosen backup is copied and checked before it replaces the Vault. */
  stagingPath: string
  /** Locks the Vault and puts the staged file in place of its database (`VaultManager.replaceDatabase`). */
  replace: (stagedPath: string) => void
}

const removeStaged = (path: string): void => {
  for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true })
}

/**
 * Puts the Vault back to one of its backups. The backup is chosen by name from the backup folder (a
 * window never supplies a path), copied aside and checked, and the Vault as it is now is backed up
 * first, so a restore can itself be undone. The Vault then locks; it opens on the restored data.
 */
export function createVaultRestore(deps: VaultRestoreDeps) {
  return {
    list: (): BackupInfo[] => deps.backups.listVault(),

    async restore(name: unknown): Promise<{ safetyBackup: string | null }> {
      const wanted = v.reqStr(name, 'Backup', 200)
      const backup = deps.backups.listVault().find((b) => b.name === wanted)
      if (!backup) throw new v.ValidationError('That backup is no longer in the backup folder.')

      removeStaged(deps.stagingPath)
      try {
        copyFileSync(backup.path, deps.stagingPath)
        let version: number
        try {
          assertSoundDatabase(deps.stagingPath)
          const db = new Database(deps.stagingPath, { fileMustExist: true })
          try {
            version = db.pragma('user_version', { simple: true }) as number
          } finally {
            db.close()
          }
        } catch {
          throw new v.ValidationError('That backup is damaged and cannot be restored.')
        }
        if (version < 1) throw new v.ValidationError('That file is not a Vault backup.')
        if (version > latestVersion(VAULT_MIGRATIONS))
          throw new v.ValidationError('That backup is from a newer version of Teaching OS.')

        let safety: BackupInfo | null
        try {
          safety = await deps.backups.vaultNow()
        } catch {
          throw new v.ValidationError(
            'The Vault as it is now could not be backed up first, so nothing was restored.'
          )
        }
        deps.replace(deps.stagingPath)
        return { safetyBackup: safety?.name ?? null }
      } catch (err) {
        removeStaged(deps.stagingPath)
        throw err
      }
    }
  }
}

export type VaultRestore = ReturnType<typeof createVaultRestore>
