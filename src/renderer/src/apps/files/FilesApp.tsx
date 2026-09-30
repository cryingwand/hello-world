import { useEffect, useRef, useState } from 'react'
import {
  baseName,
  dirName,
  kindOf,
  type FileSearchResponse,
  type FileSearchResult
} from '@shared/files'
import type { AppProps } from '@apps/types'
import ErrorBanner from '@renderer/components/ErrorBanner'
import { useApiQuery } from '@renderer/data/hooks'
import { useShell } from '@renderer/shell/ShellContext'
import AttachDialog from './AttachDialog'
import AttachedTab from './AttachedTab'
import OpenBar from './OpenBar'
import Viewer from './Viewer'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The last two folders are enough to tell two "Unit 3.pdf" files apart at a glance. */
function shortDir(path: string): string {
  const parts = dirName(path).split('/').filter(Boolean)
  return parts.length <= 2 ? `/${parts.join('/')}` : `…/${parts.slice(-2).join('/')}`
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const when = (ms: number): string =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export default function FilesApp({ intent, intentNonce }: AppProps): React.JSX.Element {
  const { setSettingsOpen } = useShell()
  const [tab, setTab] = useState<'search' | 'attached'>('search')
  const [query, setQuery] = useState('')
  const [teachingOnly, setTeachingOnly] = useState(false)
  const [includeContents, setIncludeContents] = useState(false)
  const [response, setResponse] = useState<FileSearchResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [attachFor, setAttachFor] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)
  const ticket = useRef(0)

  const settings = useApiQuery(() => window.api.settings.get(), [], ['settings.changed'])
  const noFolders = !!settings.data && settings.data.teachingFolders.length === 0
  const info = useApiQuery(
    () => (selected ? window.api.files.info(selected) : Promise.resolve(null)),
    [selected]
  )

  // A search request from the top bar or another app (the `search-files` intent).
  const [handledNonce, setHandledNonce] = useState<number | undefined>(undefined)
  if (intent?.type === 'search-files' && intentNonce !== handledNonce) {
    setHandledNonce(intentNonce)
    setQuery(intent.query)
    setTab('search')
  }

  // An `attach-file` intent from another app.
  useEffect(() => {
    if (intent?.type !== 'attach-file') return
    const { path, recordType, recordId } = intent
    window.api.fileLinks
      .add({ path, recordType, recordId })
      .then(() => {
        setSelected(path)
        setNotice(`Attached ${baseName(path)}`)
      })
      .catch((e: unknown) => setError(msg(e)))
  }, [intent, intentNonce])

  // Debounced Spotlight search; a slower, older response never replaces a newer one.
  useEffect(() => {
    const text = query.trim()
    const mine = ++ticket.current
    if (!text) return
    const timer = setTimeout(() => {
      setSearching(true)
      window.api.files
        .search({ text, teachingOnly, includeContents })
        .then((r) => mine === ticket.current && setResponse(r))
        .catch(
          (e: unknown) =>
            mine === ticket.current &&
            setResponse({ results: [], truncated: false, unavailable: msg(e) })
        )
        .finally(() => mine === ticket.current && setSearching(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, teachingOnly, includeContents])

  const select = (path: string): void => {
    if (
      path !== selected &&
      dirty.current &&
      !window.confirm('You have unsaved changes to this file. Discard them?')
    )
      return
    dirty.current = false
    setSelected(path)
    setError(null)
  }
  const pick = (): void => {
    window.api.files
      .pickFile()
      .then((p) => p && select(p))
      .catch((e: unknown) => setError(msg(e)))
  }

  const shown = query.trim() ? response : null
  const teaching = shown?.results.filter((r) => r.isTeaching) ?? []
  const elsewhere = shown?.results.filter((r) => !r.isTeaching) ?? []

  const row = (r: FileSearchResult): React.JSX.Element => (
    <li key={r.path} className={`result${selected === r.path ? ' result-active' : ''}`}>
      <button className="result-main" onClick={() => select(r.path)} title={r.path}>
        <span className={`kind kind-${r.kind}`}>
          {r.kind === 'spreadsheet' ? 'xls' : r.kind === 'other' ? '···' : r.kind}
        </span>
        <span className="result-text">
          <span className="result-name">{r.name}</span>
          <span className="hint">
            {shortDir(r.path)} · {when(r.mtime)}
          </span>
        </span>
      </button>
    </li>
  )

  return (
    <div className="split">
      <aside className="files-side" aria-label="Find files">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'search'}
            className={tab === 'search' ? 'tab tab-on' : 'tab'}
            onClick={() => setTab('search')}
          >
            Search
          </button>
          <button
            role="tab"
            aria-selected={tab === 'attached'}
            className={tab === 'attached' ? 'tab tab-on' : 'tab'}
            onClick={() => setTab('attached')}
          >
            Attached
          </button>
        </div>

        {tab === 'search' ? (
          <>
            <input
              className="search"
              type="search"
              placeholder="Search your Mac"
              aria-label="Search files"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={teachingOnly}
                  onChange={(e) => setTeachingOnly(e.target.checked)}
                />
                Teaching folders only
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeContents}
                  onChange={(e) => setIncludeContents(e.target.checked)}
                />
                Search inside files
              </label>
            </div>
            {noFolders && (
              <p className="hint">
                Set your teaching folders so their files are listed first.{' '}
                <button className="link" onClick={() => setSettingsOpen(true)}>
                  Open Settings
                </button>
              </p>
            )}
            <button className="btn" onClick={pick}>
              Choose a file…
            </button>

            {shown?.unavailable && (
              <div className="error-banner" role="alert">
                {shown.unavailable}
              </div>
            )}
            {searching && <p className="hint">Searching…</p>}
            {shown && !shown.unavailable && !searching && shown.results.length === 0 && (
              <p className="hint">No files match “{query.trim()}”.</p>
            )}
            {teaching.length > 0 && (
              <>
                <h3 className="group">In your teaching folders ({teaching.length})</h3>
                <ul className="result-list">{teaching.map(row)}</ul>
              </>
            )}
            {elsewhere.length > 0 && (
              <>
                <h3 className="group">Elsewhere on this Mac ({elsewhere.length})</h3>
                <ul className="result-list">{elsewhere.map(row)}</ul>
              </>
            )}
            {shown?.truncated && (
              <p className="hint">Showing the best matches. Add more words to narrow it down.</p>
            )}
          </>
        ) : (
          <AttachedTab selected={selected} onSelect={select} />
        )}
      </aside>

      <section className="pane files-pane">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
        {notice && (
          <div className="notice-bar" role="status">
            <span>{notice}</span>
            <button className="btn btn-quiet" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {selected ? (
          info.data === null && !info.loading ? (
            <p className="hint pad">
              This file could not be found. It may have been moved or deleted.
            </p>
          ) : (
            <>
              <div className="pane-head">
                <div className="file-title">
                  <h2>{baseName(selected)}</h2>
                  <div className="hint" title={selected}>
                    {shortDir(selected)}
                    {info.data
                      ? ` · ${formatSize(info.data.size)} · modified ${when(info.data.mtime)}`
                      : ''}
                  </div>
                </div>
              </div>
              <OpenBar path={selected} onAttach={() => setAttachFor(selected)} />
              <div className="viewer">
                <Viewer
                  key={`${selected}:${kindOf(selected)}`}
                  path={selected}
                  onDirtyChange={(d) => {
                    dirty.current = d
                  }}
                />
              </div>
            </>
          )
        ) : (
          <div className="placeholder">
            <strong>Find a file</strong>
            <span>Search on the left, or choose a file to preview it here.</span>
          </div>
        )}
      </section>

      {attachFor && (
        <AttachDialog
          path={attachFor}
          onClose={() => setAttachFor(null)}
          onAttached={(m) => {
            setAttachFor(null)
            setNotice(m)
          }}
        />
      )}
    </div>
  )
}
