import { useEffect, type ReactNode } from 'react'
import VaultGate from './VaultGate'
import { useVaultStatus } from './useVaultStatus'

/** Real activity in the window; throttled so the idle timer is not hammered. */
const HEARTBEAT_MS = 10_000

/**
 * Shows the lock screen until the vault is open, then the shell. Main closes the window when the
 * vault locks, so this is also what a window sees in the moment before it goes.
 */
export default function VaultRoot({ children }: { children: ReactNode }): React.JSX.Element {
  const status = useVaultStatus()
  const unlocked = status !== null && !status.locked

  useEffect(() => {
    if (!unlocked) return
    let last = 0
    const beat = (): void => {
      const now = Date.now()
      if (now - last < HEARTBEAT_MS) return
      last = now
      window.api.vault.touch().catch(() => undefined)
    }
    const events = ['pointerdown', 'keydown', 'wheel'] as const
    for (const e of events) window.addEventListener(e, beat, true)
    return () => {
      for (const e of events) window.removeEventListener(e, beat, true)
    }
  }, [unlocked])

  if (!status) return <main className="vault-gate" aria-busy="true" />
  if (status.locked) return <VaultGate status={status} />
  return <>{children}</>
}
