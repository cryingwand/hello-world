import { useState } from 'react'
import type { UpdateOffer, UpdateStatus, UpdateTask } from '@shared/updates'
import { useApiQuery } from '@renderer/data/hooks'

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function thisVersion(s: UpdateStatus): string {
  const b = s.build
  if (b.channel === 'local') return 'A copy built on this Mac.'
  const built = b.date ? `, made ${when(b.date)}` : ''
  if (b.channel === 'preview') return `Preview of ${b.branch}, build ${b.number}${built}.`
  return `Build ${b.number}${built}.`
}

function taskLine(t: UpdateTask): string {
  switch (t.step) {
    case 'download':
      return t.total > 0 ? `Downloading ${mb(t.received)} of ${mb(t.total)}…` : 'Downloading…'
    case 'check':
      return 'Checking the download…'
    case 'backup':
      return 'Backing up your data…'
    case 'copy':
      return 'Copying your data for the Preview…'
    case 'install':
      return 'Installing…'
  }
}

function Notes({ offer, max }: { offer: UpdateOffer; max?: number }): React.JSX.Element | null {
  const notes = max === undefined ? offer.notes : offer.notes.slice(0, max)
  if (notes.length === 0) return null
  return (
    <ul className="update-notes">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
      {notes.length < offer.notes.length && (
        <li className="hint">and {offer.notes.length - notes.length} more</li>
      )}
    </ul>
  )
}

/**
 * Settings in the everyday window: this version, a newer one if there is one, and versions still being
 * worked on, which open as a separate Preview app on a copy of the data (see docs/features/updates.md).
 */
export default function UpdatesSection(): React.JSX.Element {
  const status = useApiQuery(() => window.api.updates.status(), [], ['updates.changed'])
  const [message, setMessage] = useState<string | null>(null)
  const s = status.data

  const run = (action: () => Promise<unknown>, done?: string): void => {
    setMessage(null)
    action().then(
      () => done && setMessage(done),
      (err: unknown) => setMessage(err instanceof Error ? err.message : String(err))
    )
  }

  if (!s) return <section className="updates" aria-label="Updates" />
  const busy = s.task !== null
  const offer = s.available
  const isPreview = s.build.channel === 'preview'

  return (
    <>
      <section className="updates">
        <h3>Updates</h3>
        <p className="hint">{thisVersion(s)}</p>
        <div className="row">
          <button
            className="btn"
            disabled={s.checking || busy}
            onClick={() => run(window.api.updates.check)}
          >
            {s.checking ? 'Checking…' : 'Check now'}
          </button>
          {s.checkedAt && <span className="hint">Last checked {when(s.checkedAt)}</span>}
        </div>
        {s.error && <p className="notice">{s.error}</p>}
        {offer ? (
          <div className="update-offer">
            <p>
              <strong>{isPreview ? `A newer build of this preview` : `A new version`}</strong>{' '}
              <span className="hint">
                build {offer.number}
                {offer.date && `, ${when(offer.date)}`}
                {offer.size > 0 && `, ${mb(offer.size)}`}
              </span>
            </p>
            <Notes offer={offer} />
            {!offer.installable && (
              <p className="hint">It was not built for this Mac&apos;s processor.</p>
            )}
            {s.cannotInstall ? (
              <p className="hint">{s.cannotInstall}</p>
            ) : (
              <div className="row">
                <button
                  className="btn btn-primary"
                  disabled={busy || !offer.installable}
                  onClick={() => run(window.api.updates.install)}
                >
                  Update and restart
                </button>
                <span className="hint">
                  Your data is backed up first. It lives outside the app, so updating never changes
                  it.
                </span>
              </div>
            )}
          </div>
        ) : (
          s.checkedAt && !s.error && <p className="hint">This is the newest version.</p>
        )}
        {s.task && s.task.kind === 'update' && (
          <p className="notice" role="status">
            {taskLine(s.task)}
          </p>
        )}
      </section>

      {!isPreview && (
        <section className="updates">
          <h3>Try work in progress</h3>
          <p className="hint">
            A version still being worked on opens as a separate app, Teaching OS Preview, with a
            copy of your data. Nothing you do there changes your real data, and it cannot change
            your files or calendar.
          </p>
          {s.previews.length === 0 ? (
            <p className="hint">
              {s.checkedAt
                ? 'Nothing is being worked on right now.'
                : 'Check for updates to see what is being worked on.'}
            </p>
          ) : (
            <ul className="update-previews">
              {s.previews.map((p) => (
                <li key={p.tag}>
                  <div className="row">
                    <strong>{p.title}</strong>
                    <span className="hint">
                      {p.date && `updated ${when(p.date)}`}
                      {p.size > 0 && `, ${mb(p.size)}`}
                    </span>
                    <span className="spacer" />
                    <button
                      className="btn"
                      disabled={busy || !p.installable || s.cannotInstall !== null}
                      title={s.cannotInstall ?? undefined}
                      onClick={() =>
                        run(
                          () => window.api.updates.tryPreview(p.tag),
                          'Teaching OS Preview is open, with a fresh copy of your data.'
                        )
                      }
                    >
                      Try this version
                    </button>
                  </div>
                  <Notes offer={p} max={5} />
                </li>
              ))}
            </ul>
          )}
          {s.previewInstalled && (
            <div className="row">
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(
                    window.api.updates.refreshPreview,
                    'The Preview has a fresh copy of your data.'
                  )
                }
              >
                Refresh its copy of my data
              </button>
              <button
                className="btn btn-quiet"
                disabled={busy}
                onClick={() =>
                  run(
                    window.api.updates.removePreview,
                    'The Preview is in the Trash and its copy of your data is deleted.'
                  )
                }
              >
                Remove the Preview
              </button>
              {s.previewDataCopiedAt && (
                <span className="hint">Copy made {when(s.previewDataCopiedAt)}</span>
              )}
            </div>
          )}
          {s.task && s.task.kind === 'preview' && (
            <p className="notice" role="status">
              {taskLine(s.task)}
            </p>
          )}
        </section>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </>
  )
}
