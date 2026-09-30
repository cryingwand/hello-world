import { useState } from 'react'
import { useApiQuery } from '@renderer/data/hooks'
import VaultSettings from '@renderer/vault/VaultSettings'
import { useShell } from './ShellContext'

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { space } = useShell()
  const settings = useApiQuery(() => window.api.settings.get(), [], ['settings.changed'])
  const info = useApiQuery(() => window.api.system.info(), [])
  const backups = useApiQuery(() => window.api.backup.list(), [])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const s = settings.data
  const report = (err: unknown): void =>
    setMessage(err instanceof Error ? err.message : String(err))

  const addFolder = async (): Promise<void> => {
    try {
      const dir = await window.api.system.chooseFolder()
      if (dir && s)
        await window.api.settings.update({ teachingFolders: [...s.teachingFolders, dir] })
    } catch (err) {
      report(err)
    }
  }
  const removeFolder = (dir: string): void => {
    if (s)
      window.api.settings
        .update({ teachingFolders: s.teachingFolders.filter((f) => f !== dir) })
        .catch(report)
  }
  const chooseBackupFolder = async (): Promise<void> => {
    try {
      const dir = await window.api.system.chooseFolder()
      if (dir) await window.api.settings.update({ backupFolder: dir })
    } catch (err) {
      report(err)
    }
  }
  const backUpNow = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const b = await window.api.backup.runNow()
      setMessage(
        b.extraError
          ? `Backed up, but the extra folder failed: ${b.extraError}`
          : `Backed up ${b.name}`
      )
      backups.reload()
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Settings"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header className="modal-head">
          <h2>Settings</h2>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </header>

        <section>
          <h3>Teaching folders</h3>
          <p className="hint">Files in these folders are ranked first in search.</p>
          <ul className="folder-list">
            {s?.teachingFolders.map((f) => (
              <li key={f}>
                <code>{f}</code>
                <button className="btn btn-quiet" onClick={() => removeFolder(f)}>
                  Remove
                </button>
              </li>
            ))}
            {s && s.teachingFolders.length === 0 && <li className="hint">None yet.</li>}
          </ul>
          <button className="btn" onClick={addFolder}>
            Add folder…
          </button>
        </section>

        <section>
          <h3>Backups</h3>
          <p className="hint">
            A backup is taken at launch and daily; the last 14 days are kept in{' '}
            <code>{info.data?.backupDir}</code>. You can also copy each one to another folder.
          </p>
          <div className="row">
            <span>Extra folder:</span>
            <code>{s?.backupFolder ?? 'not set'}</code>
            <button className="btn" onClick={chooseBackupFolder}>
              Choose…
            </button>
            {s?.backupFolder && (
              <button
                className="btn btn-quiet"
                onClick={() => window.api.settings.update({ backupFolder: null }).catch(report)}
              >
                Clear
              </button>
            )}
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={backUpNow}>
              {busy ? 'Backing up…' : 'Back up now'}
            </button>
            <span className="hint">
              {backups.data?.[0] ? `Latest: ${when(backups.data[0].createdAt)}` : 'No backups yet'}
              {backups.data ? ` (${backups.data.length} on disk)` : ''}
            </span>
          </div>
        </section>

        <section>
          <h3>Stage</h3>
          <label className="row">
            <input
              type="checkbox"
              checked={s?.presentation.offerOnExternalDisplay ?? true}
              onChange={(e) =>
                window.api.settings
                  .update({ presentation: { offerOnExternalDisplay: e.target.checked } })
                  .catch(report)
              }
            />
            Offer the Stage when an external display connects
          </label>
        </section>

        {space === 'vault' ? (
          <VaultSettings />
        ) : (
          <section>
            <h3>Vault</h3>
            <p className="hint">
              Passcode, idle lock and Touch ID are in Settings inside the Vault, so they are never
              reachable from a window you might be presenting from.
            </p>
          </section>
        )}

        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <p className="hint">
          Settings and backups: <code>{info.data?.dbPath}</code>
        </p>
        <p className="hint">
          Vault: <code>{info.data?.vaultPath}</code>
        </p>
      </div>
    </div>
  )
}
