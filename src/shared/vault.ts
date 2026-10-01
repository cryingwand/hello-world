/** The message a locked-vault refusal carries, so a window can recognise it and show the lock screen. */
export const VAULT_LOCKED_MESSAGE = 'The Vault is locked.'

/** Main tells windows the vault opened or closed. */
export const VAULT_STATUS_CHANNEL = 'teachingos:vault-status'

export type LockReason =
  'manual' | 'idle' | 'presenting' | 'display' | 'screen-lock' | 'sleep' | 'quit'

export interface VaultStatus {
  /** A passcode has been chosen. False on first run (and after the passcode file is removed). */
  initialized: boolean
  locked: boolean
  touchId: { available: boolean; enabled: boolean }
  /** Milliseconds until another passcode attempt is allowed; 0 when not blocked. */
  blockedForMs: number
  autoLockMinutes: number
}

export interface VaultSettings {
  /** 0 means never lock on idle. */
  autoLockMinutes: number
  touchIdAvailable: boolean
  touchIdEnabled: boolean
  /**
   * A folder that also receives every Vault backup, or null (the default) to keep them on this Mac
   * only. Set only from the unlocked Vault; the public backup folder never receives Vault data.
   */
  backupFolder: string | null
}

export interface VaultSettingsPatch {
  autoLockMinutes?: number
  touchIdEnabled?: boolean
  /** An absolute folder path, or null to turn the extra copy of Vault backups off. */
  backupFolder?: string | null
}

export const AUTO_LOCK_CHOICES = [0, 2, 5, 10, 15, 30, 60] as const
export const DEFAULT_AUTO_LOCK_MINUTES = 10
export const MIN_PASSCODE_LENGTH = 6
