import { useShell } from './ShellContext'

/** Shown when an external display connects (or is already connected at launch). */
export default function PresentationOffer(): React.JSX.Element | null {
  const { displayOffer, dismissDisplayOffer, setPresenting } = useShell()
  if (!displayOffer) return null
  return (
    <div className="offer" role="alertdialog" aria-label="Presentation mode">
      <div>
        <strong>
          {displayOffer.reason === 'connected'
            ? 'External display connected.'
            : 'An external display is connected.'}
        </strong>
        <div className="hint">Turn on presentation mode to hide grades and student names?</div>
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={() => setPresenting(true)}>
          Turn on
        </button>
        <button className="btn" onClick={dismissDisplayOffer}>
          Not now
        </button>
      </div>
    </div>
  )
}
