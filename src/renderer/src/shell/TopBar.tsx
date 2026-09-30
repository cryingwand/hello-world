import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { APP_NAME } from '@shared/app-info'
import Icon from '@renderer/components/Icon'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'
import { registry } from './appRegistry'
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
    setPresenting,
    dispatchIntent,
    settingsOpen,
    setSettingsOpen
  } = useShell()
  const [search, setSearch] = useState('')
  const focusedWin = state.windows.find((w) => w.id === focused)
  const focusedName = focusedWin ? registry.byId.get(focusedWin.appId)?.name : undefined

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="brand" onClick={() => setSettingsOpen(true)} title="Settings">
          {APP_NAME}
        </button>
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
        <ClassPicker />
        <button
          className={`pill${presenting ? ' pill-on' : ''}`}
          aria-pressed={presenting}
          onClick={() => setPresenting(!presenting)}
          title={`Presentation mode (${window.api.platform === 'darwin' ? '⌘' : 'Ctrl+'}⇧P)`}
        >
          <Icon name="screen" size={14} />
          <span>{presenting ? 'Presenting' : 'Present'}</span>
        </button>
        <Clock />
      </div>
      {/* Portaled: the top bar's backdrop-filter would otherwise become the fixed-position container. */}
      {settingsOpen &&
        createPortal(<SettingsDialog onClose={() => setSettingsOpen(false)} />, document.body)}
    </header>
  )
}
