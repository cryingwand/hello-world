import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { APP_NAME } from '@shared/app-info'
import Icon from '@renderer/components/Icon'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'
import SettingsDialog from './SettingsDialog'
import { useShell } from './ShellContext'

const clockFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return <time className="clock">{clockFormat.format(now)}</time>
}

/** A dot on the app name when a newer version is waiting in Settings (everyday window only). */
function UpdateDot(): React.JSX.Element | null {
  const status = useApiQuery(() => window.api.updates.status(), [], ['updates.changed'])
  if (!status.data?.available) return null
  return <span className="update-dot" role="img" aria-label="An update is available" />
}

/** The Preview app says so, always: it is a version being worked on, running on a copy of the data. */
function PreviewBadge(): React.JSX.Element | null {
  const info = useApiQuery(() => window.api.system.info(), [])
  const d = info.data
  if (!d || d.build.channel !== 'preview') return null
  const copied = d.previewDataCopiedAt
    ? new Date(d.previewDataCopiedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : null
  return (
    <span
      className="preview-badge"
      title="A version still being worked on. It uses a copy of your data, and cannot change your files or calendar."
    >
      Preview of {d.build.branch}
      {copied ? ` · copy of your data from ${copied}` : ''}
    </span>
  )
}

function ClassPicker(): React.JSX.Element {
  const { currentClassId, setCurrentClassId } = useShell()
  const classes = useApiQuery(
    () => window.api.classes.list(),
    [],
    ['classes.changed', 'terms.changed']
  )
  const list = classes.data ?? []
  // Show "No class" for an id that is not in the list rather than clearing it: the list can be
  // momentarily older than a class that was just created, and clearing would drop that selection.
  const value = list.some((c) => c.id === currentClassId) ? currentClassId : ''

  return (
    <select
      className="class-picker"
      aria-label="Current class"
      value={value ?? ''}
      onChange={(e) => setCurrentClassId(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">No class</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {classLabel(c)} ({c.termName})
        </option>
      ))}
    </select>
  )
}

export default function TopBar(): React.JSX.Element {
  const {
    state,
    focused,
    presenting,
    toggleStage,
    dispatchIntent,
    settingsOpen,
    setSettingsOpen,
    registry,
    space
  } = useShell()
  const [search, setSearch] = useState('')
  const focusedWin = state.windows.find((w) => w.id === focused)
  const focusedName = focusedWin ? registry.byId.get(focusedWin.appId)?.name : undefined

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="brand" onClick={() => setSettingsOpen(true)} title="Settings">
          {APP_NAME}
          {space === 'launcher' && <UpdateDot />}
        </button>
        <PreviewBadge />
        {focusedName && <span className="topbar-app">{focusedName}</span>}
      </div>
      <form
        className="topbar-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (search.trim()) dispatchIntent({ type: 'search-files', query: search.trim() })
        }}
      >
        <Icon name="search" size={14} />
        <input
          type="search"
          placeholder="Search files"
          aria-label="Search files"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>
      <div className="topbar-right">
        {space === 'vault' && <ClassPicker />}
        {space === 'vault' && (
          <button
            className="pill"
            onClick={() => window.api.vaultGate.lock()}
            title="Lock the Vault and close this window"
          >
            <Icon name="lock" size={14} />
            <span>Lock</span>
          </button>
        )}
        {space === 'launcher' && (
          <button
            className={`pill${presenting ? ' pill-on' : ''}`}
            aria-pressed={presenting}
            onClick={toggleStage}
            title={`Start or end the Stage (${window.api.platform === 'darwin' ? '⌘' : 'Ctrl+'}⇧P)`}
          >
            <Icon name="screen" size={14} />
            <span>{presenting ? 'On stage' : 'Present'}</span>
          </button>
        )}
        <Clock />
      </div>
      {/* Portaled: the top bar's backdrop-filter would otherwise become the fixed-position container. */}
      {settingsOpen &&
        createPortal(<SettingsDialog onClose={() => setSettingsOpen(false)} />, document.body)}
    </header>
  )
}
