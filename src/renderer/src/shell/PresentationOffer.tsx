import { useShell } from './ShellContext'

/** Shown when an external display connects (or is already connected at launch). */
export default function PresentationOffer(): React.JSX.Element | null {
  const { displayOffer, dismissDisplayOffer, openApp } = useShell()
  if (!displayOffer) return null
  return (
    <div className="offer" role="alertdialog" aria-label="Stage">
      <div>
        <strong>
          {displayOffer.reason === 'connected'
            ? 'External display connected.'
            : 'An external display is connected.'}
        </strong>
        <div className="hint">
          The Vault is locked while it is. Show files on it with the Stage?
        </div>
      </div>
      <div className="row">
        <button
          className="btn btn-primary"
          onClick={() => {
            dismissDisplayOffer()
            openApp('presenter')
          }}
        >
          Open Presenter
        </button>
        <button className="btn" onClick={dismissDisplayOffer}>
          Not now
        </button>
      </div>
    </div>
  )
}
