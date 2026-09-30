import { useRef, useState } from 'react'
import { baseName, type ProtectedEntry } from '@shared/files'
import type { AppProps } from '@apps/types'
import ErrorBanner from '@renderer/components/ErrorBanner'
import Icon from '@renderer/components/Icon'
import { useApiQuery } from '@renderer/data/hooks'
import FileDetail from '../files/FileDetail'
import { formatSize, when } from '../files/format'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Exams, quizzes, answer keys: whatever is in the folders chosen here is kept out of everyday
 * search and every window outside the Vault. This is the only place those files can be browsed.
 */
export default function ProtectedApp(_props: AppProps): React.JSX.Element {
  const [dir, setDir] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)

  const folders = useApiQuery(() => window.api.protection.folders(), [], ['protection.changed'])
  const listing = useApiQuery(
    () => (dir ? window.api.protection.browse(dir) : Promise.resolve(null)),
    [dir],
    ['protection.changed']
  )

  const confirmDiscard = (): boolean =>
    !dirty.current || window.confirm('You have unsaved changes to this file. Discard them?')
  const select = (path: string): void => {
    if (path !== selected && !confirmDiscard()) return
    dirty.current = false
    setSelected(path)
    setError(null)
  }
  const go = (next: string | null): void => {
    setDir(next)
    setError(null)
  }

  const add = (): void => {
    window.api.protection
      .chooseAndAdd()
      .then(() => folders.reload())
      .catch((e: unknown) => setError(msg(e)))
  }
  const remove = (path: string): void => {
    const ok = window.confirm(
      `Stop protecting ${baseName(path)}?\n\nIts files will show up in everyday search and in presentations again.`
    )
    if (!ok) return
    window.api.protection
      .remove(path)
      .then(() => {
        if (dir && (dir === path || dir.startsWith(`${path}/`))) go(null)
        folders.reload()
      })
      .catch((e: unknown) => setError(msg(e)))
  }

  const entry = (e: ProtectedEntry): React.JSX.Element => (
    <li key={e.path} className={`result${selected === e.path ? ' result-active' : ''}`}>
      <button
        className="result-main"
        onClick={() => (e.isDir ? go(e.path) : select(e.path))}
        title={e.path}
      >
        <span className={`kind kind-${e.isDir ? 'folder' : e.kind}`}>
          {e.isDir ? <Icon name="folder" size={12} /> : e.kind === 'other' ? '···' : e.kind}
        </span>
        <span className="result-text">
          <span className="result-name">{e.name}</span>
          <span className="hint">
            {e.isDir ? 'Folder' : `${formatSize(e.size)} · ${when(e.mtime)}`}
          </span>
        </span>
      </button>
    </li>
  )

  const list = listing.data
  return (
    <div className="split">
      <aside className="files-side" aria-label="Protected folders">
        {dir === null || listing.error ? (
          <>
            <p className="hint">
              Files in these folders stay inside the Vault. They do not appear in search, previews
              or presentations anywhere else.
            </p>
            <button className="btn btn-primary" onClick={add}>
              Protect a folder…
            </button>
            {listing.error && (
              <div className="error-banner" role="alert">
                {listing.error}
              </div>
            )}
            <ul className="result-list">
              {(folders.data ?? []).map((f) => (
                <li key={f.path} className="result">
                  <button className="result-main" disabled={!f.exists} onClick={() => go(f.path)}>
                    <span className="kind kind-folder">
                      <Icon name="lock" size={12} />
                    </span>
                    <span className="result-text">
                      <span className="result-name">{baseName(f.path)}</span>
                      <span className="hint" title={f.path}>
                        {f.exists ? f.path : 'Not found right now. It is still protected.'}
                      </span>
                    </span>
                  </button>
                  <button className="btn btn-quiet" onClick={() => remove(f.path)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {folders.data?.length === 0 && (
              <p className="hint">
                Nothing is protected yet. Add the folders that hold your exams, quizzes and answer
                keys.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="crumb">
              <button className="btn btn-quiet" onClick={() => go(list?.parent ?? null)}>
                {list?.parent ? 'Up' : 'All folders'}
              </button>
              <strong title={dir}>{baseName(dir)}</strong>
            </div>
            {listing.loading && !list && <p className="hint">Loading…</p>}
            {list && list.entries.length === 0 && <p className="hint">This folder is empty.</p>}
            <ul className="result-list">{list?.entries.map(entry)}</ul>
            {list?.truncated && <p className="hint">Only the first entries are shown.</p>}
          </>
        )}
      </aside>

      <section className="pane files-pane">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        {selected ? (
          <FileDetail
            path={selected}
            onDirtyChange={(d) => {
              dirty.current = d
            }}
          />
        ) : (
          <div className="placeholder">
            <strong>Protected files</strong>
            <span>Choose a file on the left to preview it here.</span>
          </div>
        )}
      </section>
    </div>
  )
}
