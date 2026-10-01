import { useState } from 'react'
import type { BackupInfo } from '@shared/models'
import { useApiQuery } from '@renderer/data/hooks'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const size = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`

/** How many backups to list before "Show all". */
const SHORT_LIST = 8

/** The Vault's backups, and putting the Vault back to one of them. Only shown inside the Vault. */
export default function VaultBackups(): React.JSX.Element {
  const backups = useApiQuery(() => window.api.vault.backups(), [])
  const [all, setAll] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const list = backups.data ?? []
  const shown = all ? list : list.slice(0, SHORT_LIST)

  const restore = (b: BackupInfo): void => {
    const ok = window.confirm(
      `Put the Vault back to how it was on ${when(b.createdAt)}?\n\n` +
        'Everything changed since then is replaced. A backup of the Vault as it is now is taken ' +
        'first, so you can undo this by restoring that one.\n\n' +
        'The Vault closes; open it again to see the restored data.'
    )
    if (!ok) return
    setBusy(true)
    setMessage(null)
    // On success the Vault locks and this window closes, so only a refusal comes back.
    window.api.vault.restore(b.name).catch((e: unknown) => {
      setBusy(false)
      setMessage(msg(e))
      backups.reload()
    })
  }

  return (
    <section>
      <h3>Restore the Vault</h3>
      <p className="hint">
        Backups are taken at launch, daily, and just before anything is deleted or imported over.
        Every backup from the last 14 days is kept, then one a week for 16 weeks and one a month for
        a year.
      </p>
      <ul className="folder-list">
        {shown.map((b) => (
          <li key={b.name}>
            <span>
              {when(b.createdAt)} <span className="hint">({size(b.size)})</span>
            </span>
            <button className="btn btn-quiet" disabled={busy} onClick={() => restore(b)}>
              Restore…
            </button>
          </li>
        ))}
        {backups.data && list.length === 0 && <li className="hint">No Vault backups yet.</li>}
      </ul>
      {list.length > SHORT_LIST && (
        <button className="btn btn-quiet" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
