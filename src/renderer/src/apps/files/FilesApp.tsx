import { useEffect, useRef, useState } from 'react'
import { baseName, dirName, type FileSearchResponse, type FileSearchResult } from '@shared/files'
import type { AppProps } from '@apps/types'
import ErrorBanner from '@renderer/components/ErrorBanner'
import Icon from '@renderer/components/Icon'
import { useApiQuery } from '@renderer/data/hooks'
import { useShell } from '@renderer/shell/ShellContext'
import AttachDialog from './AttachDialog'
import AttachedTab from './AttachedTab'
import FileDetail from './FileDetail'
import FolderBrowser from './FolderBrowser'
import { shortDir, when } from './format'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * `library` is the everyday view: search and preview, nothing tied to a student or class.
 * `vault` adds attaching files to records and is only ever shown in the protected window.
 */
export type FilesScope = 'library' | 'vault'

export default function FilesApp({
  intent,
  intentNonce,
  scope
}: AppProps & { scope: FilesScope }): React.JSX.Element {
  const inVault = scope === 'vault'
  const { setSettingsOpen } = useShell()
  const [tab, setTab] = useState<'browse' | 'search' | 'attached'>('browse')
  const [browseTo, setBrowseTo] = useState<{ path: string; nonce: number } | null>(null)
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

  // A search request from the top bar or another app (the `search-files` intent).
  const [handledNonce, setHandledNonce] = useState<number | undefined>(undefined)
  if (intent?.type === 'search-files' && intentNonce !== handledNonce) {
    setHandledNonce(intentNonce)
    setQuery(intent.query)
    setTab('search')
  }
  // An `open-path` intent: a folder (or a file's folder) pinned on the desktop.
  if (intent?.type === 'open-path' && intentNonce !== handledNonce) {
    setHandledNonce(intentNonce)
    setTab('browse')
    setBrowseTo({
      path: intent.isDir ? intent.path : dirName(intent.path),
      nonce: (browseTo?.nonce ?? 0) + 1
    })
    if (!intent.isDir) setSelected(intent.path)
  }

  // An `attach-file` intent from another app.
  useEffect(() => {
    if (!inVault || intent?.type !== 'attach-file') return
    const { path, recordType, recordId } = intent
    window.api.fileLinks
      .add({ path, recordType, recordId })
      .then(() => {
        setSelected(path)
        setNotice(`Attached ${baseName(path)}`)
      })
      .catch((e: unknown) => setError(msg(e)))
  }, [intent, intentNonce, inVault])

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
          <span className="result-name">
            {r.isProtected && (
              <span className="lock-badge" title="Protected: only shown inside the Vault">
                <Icon name="lock" size={12} />
              </span>
            )}
            {r.name}
          </span>
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
          {(inVault
            ? (['browse', 'search', 'attached'] as const)
            : (['browse', 'search'] as const)
          ).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? 'tab tab-on' : 'tab'}
              onClick={() => setTab(k)}
            >
              {k === 'browse' ? 'Browse' : k === 'search' ? 'Search' : 'Attached'}
            </button>
          ))}
        </div>

        {tab === 'browse' ? (
          <FolderBrowser
            goTo={browseTo?.path ?? null}
            goToNonce={browseTo?.nonce ?? 0}
            selected={selected}
            onSelectFile={select}
            onError={setError}
            canPin={!inVault}
          />
        ) : tab === 'search' ? (
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
          <FileDetail
            path={selected}
            onAttach={inVault ? () => setAttachFor(selected) : undefined}
            onDirtyChange={(d) => {
              dirty.current = d
            }}
          />
        ) : (
          <div className="placeholder">
            <strong>Find a file</strong>
            <span>Search on the left, or choose a file to preview it here.</span>
          </div>
        )}
      </section>

      {inVault && attachFor && (
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
