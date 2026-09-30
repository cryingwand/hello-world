import { useEffect, useState } from 'react'
import { APP_NAME } from '@shared/app-info'
import Icon from '@renderer/components/Icon'
import { registry } from './appRegistry'
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

export default function TopBar(): React.JSX.Element {
  const { state, focused, presenting, setPresenting } = useShell()
  const focusedWin = state.windows.find((w) => w.id === focused)
  const focusedName = focusedWin ? registry.byId.get(focusedWin.appId)?.name : undefined

  return (
    <header className="topbar">
      <div className="topbar-left">
        <strong className="brand">{APP_NAME}</strong>
        {focusedName && <span className="topbar-app">{focusedName}</span>}
      </div>
      <label className="topbar-search">
        <Icon name="search" size={14} />
        <input type="search" placeholder="Search files" disabled aria-label="Search files" />
      </label>
      <div className="topbar-right">
        <select className="class-picker" disabled aria-label="Current class" defaultValue="">
          <option value="">No class</option>
        </select>
        <button
          className={`pill${presenting ? ' pill-on' : ''}`}
          aria-pressed={presenting}
          onClick={() => setPresenting(!presenting)}
          title="Presentation mode"
        >
          <Icon name="screen" size={14} />
          <span>Present</span>
        </button>
        <Clock />
      </div>
    </header>
  )
}
