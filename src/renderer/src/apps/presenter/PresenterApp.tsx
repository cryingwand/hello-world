import { useEffect, useRef, useState } from 'react'
import { baseName, type FileSearchResponse } from '@shared/files'
import { isStageKind } from '@shared/stage'
import type { AppProps } from '@apps/types'
import ErrorBanner from '@renderer/components/ErrorBanner'
import { useShell } from '@renderer/shell/ShellContext'
import { shortDir } from '../files/format'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const hotkey = `${window.api.platform === 'darwin' ? '⌘' : 'Ctrl+'}⇧P`

/**
 * Builds what goes on the Stage and controls it. The Stage is a separate window with no access to
 * the Vault: starting it closes the Vault, and only the files queued here can appear on it.
 */
export default function PresenterApp(_props: AppProps): React.JSX.Element {
  const { stage } = useShell()
  const [query, setQuery] = useState('')
  const [response, setResponse] = useState<FileSearchResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ticket = useRef(0)

  // Debounced Spotlight search; a slower, older response never replaces a newer one.
  useEffect(() => {
    const text = query.trim()
    const mine = ++ticket.current
    if (!text) return
    const timer = setTimeout(() => {
      setSearching(true)
      window.api.files
        .search({ text, teachingOnly: false, includeContents: false })
        .then((r) => mine === ticket.current && setResponse(r))
        .catch(
          (e: unknown) =>
            mine === ticket.current &&
            setResponse({ results: [], truncated: false, unavailable: msg(e) })
        )
        .finally(() => mine === ticket.current && setSearching(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const run = (p: Promise<unknown>): void => {
    setError(null)
    p.catch((e: unknown) => setError(msg(e)))
  }
  const choose = (): void =>
    run(window.api.files.pickFile().then((p) => (p ? window.api.stage.add([p]) : undefined)))

  const shown = query.trim() ? response : null
  const stageable = shown?.results.filter((r) => isStageKind(r.kind)) ?? []
  const skipped = (shown?.results.length ?? 0) - stageable.length
  const items = stage?.items ?? []
  const active = stage?.active ?? false
  const external = stage?.externalDisplays ?? 0

  return (
    <div className="split">
      <aside className="files-side" aria-label="Find files to present">
        <input
          className="search"
          type="search"
          placeholder="Search for files to show"
          aria-label="Search files to present"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button className="btn" onClick={choose}>
          Choose a file…
        </button>
        {shown?.unavailable && (
          <div className="error-banner" role="alert">
            {shown.unavailable}
          </div>
        )}
        {searching && <p className="hint">Searching…</p>}
        {shown && !shown.unavailable && !searching && stageable.length === 0 && (
          <p className="hint">No PDF, image, Word or text files match “{query.trim()}”.</p>
        )}
        <ul className="result-list">
          {stageable.map((r) => (
            <li key={r.path} className="result">
              <button
                className="result-main"
                onClick={() => run(window.api.stage.add([r.path]))}
                title={`Add ${r.name} to the Stage`}
              >
                <span className={`kind kind-${r.kind}`}>{r.kind}</span>
                <span className="result-text">
                  <span className="result-name">{r.name}</span>
                  <span className="hint">{shortDir(r.path)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {skipped > 0 && (
          <p className="hint">
            {skipped} other match{skipped === 1 ? '' : 'es'} can not be shown on the Stage. Open
            slides and spreadsheets from Files in their own app.
          </p>
        )}
      </aside>

      <section className="pane presenter-pane">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        <div className="stage-status">
          <div>
            <strong>{active ? 'The Stage is showing' : 'The Stage is off'}</strong>
            <div className="hint">
              {active
                ? `Press Esc on the Stage, or ${hotkey}, to end it.`
                : external > 0
                  ? 'The Stage will fill the other display.'
                  : 'No other display is connected, so the Stage will fill this screen.'}
            </div>
          </div>
          <div className="row">
            {active ? (
              <button className="btn btn-primary" onClick={() => run(window.api.stage.end())}>
                End the Stage
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => run(window.api.stage.start())}>
                Start the Stage
              </button>
            )}
          </div>
        </div>
        {!active && (
          <p className="hint">
            Starting the Stage closes the Vault. It stays closed until you end the Stage.
          </p>
        )}

        <div className="row stage-controls">
          <button
            className="btn"
            disabled={!active || (stage?.index ?? 0) <= 0}
            onClick={() => run(window.api.stage.previous())}
          >
            Previous
          </button>
          <button
            className="btn"
            disabled={!active || (stage?.index ?? 0) >= items.length - 1}
            onClick={() => run(window.api.stage.next())}
          >
            Next
          </button>
          <button
            className={`btn${stage?.blanked ? ' btn-primary' : ''}`}
            disabled={!active}
            aria-pressed={!!stage?.blanked}
            onClick={() => run(window.api.stage.blank())}
          >
            {stage?.blanked ? 'Show' : 'Blank'}
          </button>
          <span className="hint">
            Stage keys: ] and [ for next and previous, B to blank, Esc to end.
          </span>
        </div>

        <h3 className="group">Queue ({items.length})</h3>
        {items.length === 0 ? (
          <p className="hint">
            Nothing queued yet. Search on the left and click a file to add it. PDFs, images, Word
            documents and text files can be shown.
          </p>
        ) : (
          <ol className="queue">
            {items.map((item, i) => (
              <li key={`${item.name}:${i}`} className={i === stage?.index ? 'queue-on' : ''}>
                <button
                  className="queue-main"
                  disabled={!active}
                  onClick={() => run(window.api.stage.goto(i))}
                  title={active ? `Show ${item.name}` : item.name}
                >
                  <span className="queue-n">{i + 1}</span>
                  <span className={`kind kind-${item.kind}`}>{item.kind}</span>
                  <span className="queue-name">{item.name}</span>
                </button>
                <button
                  className="btn btn-quiet"
                  aria-label={`Move ${item.name} up`}
                  disabled={i === 0}
                  onClick={() => run(window.api.stage.move(i, i - 1))}
                >
                  ↑
                </button>
                <button
                  className="btn btn-quiet"
                  aria-label={`Move ${item.name} down`}
                  disabled={i === items.length - 1}
                  onClick={() => run(window.api.stage.move(i, i + 1))}
                >
                  ↓
                </button>
                <button
                  className="btn btn-quiet"
                  aria-label={`Remove ${baseName(item.name)}`}
                  onClick={() => run(window.api.stage.remove(i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}
        {items.length > 0 && (
          <button className="btn btn-quiet" onClick={() => run(window.api.stage.clear())}>
            Clear the queue
          </button>
        )}
      </section>
    </div>
  )
}
