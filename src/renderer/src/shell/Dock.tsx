import Icon from '@renderer/components/Icon'
import { registry } from './appRegistry'
import { useShell } from './ShellContext'

export default function Dock(): React.JSX.Element {
  const { state, focused, openApp, presenting } = useShell()
  return (
    <nav className="dock" aria-label="Apps">
      {registry.apps.map((app) => {
        const win = state.windows.find((w) => w.appId === app.id)
        const active = !!win && win.id === focused
        const blocked = presenting && !app.presentationSafe
        return (
          <button
            key={app.id}
            className={`dock-item${active ? ' dock-active' : ''}${blocked ? ' dock-blocked' : ''}`}
            disabled={blocked}
            onClick={() => openApp(app.id)}
            title={blocked ? `${app.name} is hidden while presenting` : app.name}
            aria-label={app.name}
          >
            <span className="dock-icon">
              <Icon name={app.icon} size={26} />
            </span>
            <span className="dock-label">{app.name}</span>
            <span
              className={`dock-dot${win ? (win.minimized ? ' dock-dot-min' : ' dock-dot-on') : ''}`}
            />
          </button>
        )
      })}
    </nav>
  )
}
