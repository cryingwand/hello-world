import { useEffect, useState } from 'react'
import type { VaultStatus } from '@shared/vault'

/** A status plus the moment it arrived, so a countdown can be worked out from `blockedForMs`. */
export type TimedVaultStatus = VaultStatus & { receivedAt: number }

/** The vault's lock state, kept current as main reports it opening, closing and being blocked. */
export function useVaultStatus(): TimedVaultStatus | null {
  const [status, setStatus] = useState<TimedVaultStatus | null>(null)
  useEffect(() => {
    let live = true
    const off = window.api.onVaultStatus((s) => live && setStatus({ ...s, receivedAt: Date.now() }))
    window.api.vaultGate
      .status()
      .then((s) => live && setStatus((cur) => cur ?? { ...s, receivedAt: Date.now() }))
      .catch(() => undefined)
    return () => {
      live = false
      off()
    }
  }, [])
  return status
}
