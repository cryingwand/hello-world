import { useState } from 'react'
import { AUTO_LOCK_CHOICES, MIN_PASSCODE_LENGTH, type VaultSettingsPatch } from '@shared/vault'
import { useApiQuery } from '@renderer/data/hooks'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const choiceLabel = (m: number): string =>
  m === 0 ? 'Never' : m === 60 ? '1 hour' : `${m} minutes`

/** Passcode, idle lock, Touch ID and the Vault's backup folder. Only ever shown inside the Vault window. */
export default function VaultSettings(): React.JSX.Element {
  const settings = useApiQuery(() => window.api.vault.settings(), [])
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const s = settings.data

  const update = (patch: VaultSettingsPatch): void => {
    setMessage(null)
    window.api.vault
      .updateSettings(patch)
      .then(() => settings.reload())
      .catch((e: unknown) => {
        setMessage(msg(e))
        settings.reload()
      })
  }

  const chooseBackupFolder = async (): Promise<void> => {
    try {
      const dir = await window.api.system.chooseFolder()
      if (dir) update({ backupFolder: dir })
    } catch (e) {
      setMessage(msg(e))
    }
  }

  const change = (): void => {
    setBusy(true)
    setMessage(null)
    window.api.vault.changePasscode(current, next).then(
      () => {
        setBusy(false)
        setCurrent('')
        setNext('')
        setMessage('Passcode changed.')
      },
      (e: unknown) => {
        setBusy(false)
        setMessage(msg(e))
      }
    )
  }

  return (
    <>
      <section>
        <h3>Vault</h3>
        <label className="row">
          <span>Lock when idle:</span>
          <select
            aria-label="Lock when idle"
            value={s?.autoLockMinutes ?? 10}
            onChange={(e) => update({ autoLockMinutes: Number(e.target.value) })}
          >
            {AUTO_LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {choiceLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          The Vault also locks when you start a presentation, connect another display, lock the
          screen or sleep.
        </p>
        {s?.touchIdAvailable && (
          <label className="row">
            <input
              type="checkbox"
              checked={s.touchIdEnabled}
              onChange={(e) => update({ touchIdEnabled: e.target.checked })}
            />
            Unlock with Touch ID
          </label>
        )}
        <form
          className="vault-change"
          onSubmit={(e) => {
            e.preventDefault()
            change()
          }}
        >
          <input
            type="password"
            autoComplete="off"
            placeholder="Current passcode"
            aria-label="Current passcode"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            type="password"
            autoComplete="off"
            placeholder={`New passcode (${MIN_PASSCODE_LENGTH}+ characters)`}
            aria-label="New passcode"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <button
            type="submit"
            className="btn"
            disabled={busy || current.length === 0 || next.length === 0}
          >
            Change passcode
          </button>
        </form>
      </section>
      <section>
        <h3>Vault backups</h3>
        <p className="hint">
          Vault backups stay in the backups folder on this Mac unless you choose a folder here. The
          extra folder under Backups above never receives them. A copy holds every student, grade,
          advising note and exam, and once it is in another folder the passcode no longer protects
          it: anyone with that drive can open it, and a Google Drive, iCloud or Dropbox folder sends
          it off this Mac.
        </p>
        <div className="row">
          <span>Also copy Vault backups to:</span>
          <code>{s?.backupFolder ?? 'off'}</code>
          <button className="btn" onClick={chooseBackupFolder}>
            Choose…
          </button>
          {s?.backupFolder && (
            <button className="btn btn-quiet" onClick={() => update({ backupFolder: null })}>
              Turn off
            </button>
          )}
        </div>
      </section>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </>
  )
}
