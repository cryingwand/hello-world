import Icon from '@renderer/components/Icon'
import { useVaultStatus } from '@renderer/vault/useVaultStatus'
import { useShell } from './ShellContext'

export default function Dock(): React.JSX.Element {
  const { state, focused, openApp, presenting, registry, space } = useShell()
  // The launcher only learns whether the Vault is open, never anything inside it.
  const vault = useVaultStatus()
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
      {space === 'launcher' && (
        <button
          className="dock-item dock-vault"
          onClick={() => window.api.vaultGate.openWindow().catch(() => undefined)}
          title={vault && !vault.locked ? 'The Vault is open' : 'Open the Vault'}
          aria-label="Vault"
        >
          <span className="dock-icon">
            <Icon name="lock" size={26} />
          </span>
          <span className="dock-label">{vault && !vault.locked ? 'Vault (open)' : 'Vault'}</span>
          <span className={`dock-dot${vault && !vault.locked ? ' dock-dot-on' : ''}`} />
        </button>
      )}
    </nav>
  )
}
