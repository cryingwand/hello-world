import type { VaultSettings, VaultSettingsPatch, VaultStatus } from '@shared/vault'
import { ValidationError } from '../validate'
import type { VaultManager } from './manager'

export interface GateDeps<S> {
  manager: VaultManager<S>
  /** A presentation is running. The vault cannot be opened then. */
  presenting: () => boolean
  /** How many external displays are connected right now. */
  externalDisplays: () => number
  /** Asks the person, natively (a window cannot answer for them), whether to open anyway. */
  confirmExternalDisplay: () => Promise<boolean>
}

/**
 * The rules around opening the vault, in front of the manager:
 * not while presenting, and only after confirmation if an external display is connected, since the
 * audience could then see what is opened.
 */
export function createVaultGate<S>(deps: GateDeps<S>) {
  const { manager } = deps

  const refuseIfPresenting = (): void => {
    if (deps.presenting())
      throw new ValidationError('End the presentation before opening the Vault.')
  }

  /**
   * Runs after a successful unlock; locks again if a presentation started while the passcode was
   * being checked, or if the person declines to open with another display connected.
   */
  const confirmDisplays = async (): Promise<void> => {
    if (deps.presenting()) {
      manager.lock('presenting')
      throw new ValidationError('End the presentation before opening the Vault.')
    }
    if (deps.externalDisplays() === 0) return
    // A dialog that fails to show counts as "no": when in doubt the vault stays closed.
    const ok = await deps.confirmExternalDisplay().catch(() => false)
    if (!ok) {
      manager.lock('display')
      throw new ValidationError('The Vault stays locked while another display is connected.')
    }
  }

  return {
    status: (): VaultStatus => manager.status(),

    async setup(passcode: unknown, touchId?: boolean): Promise<VaultStatus> {
      refuseIfPresenting()
      const s = await manager.setup(passcode, { touchId: !!touchId })
      await confirmDisplays()
      return s
    },

    async unlock(passcode: unknown): Promise<VaultStatus> {
      refuseIfPresenting()
      const s = await manager.unlock(passcode)
      await confirmDisplays()
      return s
    },

    async unlockWithTouchId(): Promise<VaultStatus> {
      refuseIfPresenting()
      const s = await manager.unlockWithTouchId()
      await confirmDisplays()
      return s
    },

    lock: (): void => manager.lock('manual'),

    // The pieces that need an unlocked vault.
    touch: (): void => manager.touch(),
    settings: (): VaultSettings => manager.settings(),
    changePasscode: (current: unknown, next: unknown): Promise<void> =>
      manager.changePasscode(current, next),
    async updateSettings(patch: VaultSettingsPatch): Promise<VaultSettings> {
      if (patch.autoLockMinutes !== undefined) manager.setAutoLock(patch.autoLockMinutes)
      if (patch.touchIdEnabled !== undefined) await manager.setTouchId(!!patch.touchIdEnabled)
      if (patch.backupFolder !== undefined) manager.setBackupFolder(patch.backupFolder)
      return manager.settings()
    }
  }
}

export type VaultGate<S> = ReturnType<typeof createVaultGate<S>>
