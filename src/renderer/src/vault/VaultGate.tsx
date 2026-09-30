import { useEffect, useState } from 'react'
import { MIN_PASSCODE_LENGTH } from '@shared/vault'
import Icon from '@renderer/components/Icon'
import type { TimedVaultStatus } from './useVaultStatus'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Seconds left of a block that main reported; ticks only while there is one, so the button returns. */
function useCountdown(status: TimedVaultStatus): number {
  const [now, setNow] = useState(() => Date.now())
  const blocked = status.blockedForMs > 0
  useEffect(() => {
    if (!blocked) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [blocked, status.receivedAt])
  if (!blocked) return 0
  const at = Math.max(now, status.receivedAt)
  return Math.max(0, Math.ceil((status.receivedAt + status.blockedForMs - at) / 1000))
}

/**
 * The only thing a locked Vault window shows. It holds no student data: until the passcode is
 * accepted, main refuses every call that could return any.
 */
export default function VaultGate({ status }: { status: TimedVaultStatus }): React.JSX.Element {
  const first = !status.initialized
  const [passcode, setPasscode] = useState('')
  const [again, setAgain] = useState('')
  const [touch, setTouch] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wait = useCountdown(status)
  const touchReady = status.touchId.available && status.touchId.enabled

  const submit = (): void => {
    if (busy || wait > 0) return
    if (first && passcode !== again) {
      setError('The two passcodes do not match.')
      return
    }
    setBusy(true)
    setError(null)
    const run = first
      ? window.api.vaultGate.setup(passcode, status.touchId.available && touch)
      : window.api.vaultGate.unlock(passcode)
    run.then(
      // The window swaps to the shell when main announces the vault is open.
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false)
        setPasscode('')
        setAgain('')
        setError(msg(e))
      }
    )
  }

  const useTouch = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    window.api.vaultGate.unlockWithTouchId().then(
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false)
        setError(msg(e))
      }
    )
  }

  return (
    <main className="vault-gate">
      <form
        className="vault-card"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span className="vault-lock">
          <Icon name="lock" size={34} />
        </span>
        <h1>{first ? 'Set up the Vault' : 'The Vault is locked'}</h1>
        <p className="hint">
          {first
            ? 'Rosters, grades and protected files live here, apart from everything you present. Choose a passcode to open it.'
            : 'Enter your passcode to open the gradebook, classes and protected files.'}
        </p>

        <label className="vault-field">
          <span>{first ? 'New passcode' : 'Passcode'}</span>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            aria-label={first ? 'New passcode' : 'Passcode'}
          />
        </label>
        {first && (
          <>
            <label className="vault-field">
              <span>Repeat it</span>
              <input
                type="password"
                autoComplete="off"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                aria-label="Repeat the passcode"
              />
            </label>
            <p className="hint">
              At least {MIN_PASSCODE_LENGTH} characters. There is no reset: if you forget it, see
              the README to start over without losing your data.
            </p>
            {status.touchId.available && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={touch}
                  onChange={(e) => setTouch(e.target.checked)}
                />
                Also unlock with Touch ID
              </label>
            )}
          </>
        )}

        {wait > 0 && (
          <div className="error-banner" role="alert">
            Too many wrong attempts. Try again in {wait} second{wait === 1 ? '' : 's'}.
          </div>
        )}
        {error && wait === 0 && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <div className="vault-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || wait > 0 || passcode.length === 0}
          >
            {busy ? 'Opening…' : first ? 'Create and open' : 'Unlock'}
          </button>
          {!first && touchReady && (
            <button type="button" className="btn" disabled={busy} onClick={useTouch}>
              Use Touch ID
            </button>
          )}
        </div>
        <p className="hint vault-note">
          The passcode keeps the Vault closed inside this app. It does not encrypt the files on
          disk; turn on FileVault for that.
        </p>
      </form>
    </main>
  )
}
