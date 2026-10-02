import type { ReactNode } from 'react'
import Icon from '@renderer/components/Icon'

/** The filled tag that says this is the Vault. Present in the title bar of every Vault window. */
export function VaultTag(): React.JSX.Element {
  return (
    <span className="vault-tag">
      <Icon name="lock" size={12} />
      VAULT
    </span>
  )
}

/** The 28px strip at the bottom of the Vault window. It never scrolls away. */
export function VaultFooter({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <footer className="vault-footer" role="status">
      {children}
    </footer>
  )
}

/** Two keylines round the whole Vault window, so it is recognisable without colour. */
export function VaultFrame({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="vault-frame">
      <div className="vault-frame-inner">{children}</div>
    </div>
  )
}
