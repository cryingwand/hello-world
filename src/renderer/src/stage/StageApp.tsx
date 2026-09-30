import { useEffect, useState } from 'react'
import type { StageView } from '@shared/stage'
import { PAPER_CSS } from '../apps/files/paper'

/** Page text sized for a room, not a desk: scaled to the height of the display. */
const STAGE_DOCX_CSS = 'body{font-size:3.4vh !important;padding:5vh 7vw !important}'

/**
 * The projector window. It draws whatever main pushes and nothing else: it has no way to ask for a
 * file, a name or a record, and its keys are handled in the main process.
 */
export default function StageApp(): React.JSX.Element {
  const [view, setView] = useState<StageView | null>(null)
  useEffect(() => {
    let live = true
    const off = window.api.onStageView((v) => live && setView(v))
    window.api.stage
      .view()
      .then((v) => live && setView((cur) => cur ?? v))
      .catch(() => undefined)
    return () => {
      live = false
      off()
    }
  }, [])

  const c = view?.content
  return (
    <main className="stage" aria-label="Stage">
      {c?.message && <p className="stage-message">{c.message}</p>}
      {c?.kind === 'pdf' && c.url && (
        // Keyboard focus stays in the window, so main's key handling sees every key.
        <iframe
          key={c.url}
          title={c.name}
          className="stage-frame"
          src={`${c.url}#toolbar=0&navpanes=0&view=FitH`}
        />
      )}
      {c?.kind === 'image' && c.url && (
        <img key={c.url} className="stage-image" src={c.url} alt={c.name} />
      )}
      {c?.kind === 'docx' && c.html !== undefined && (
        <iframe
          title={c.name}
          className="stage-frame stage-paper"
          sandbox=""
          srcDoc={`<!doctype html><meta charset="utf-8"><style>${PAPER_CSS}${STAGE_DOCX_CSS}</style><body>${c.html}</body>`}
        />
      )}
      {c?.kind === 'text' && c.text !== undefined && <pre className="stage-text">{c.text}</pre>}
      {view && view.active && !c && !view.blanked && view.count === 0 && (
        <p className="stage-message">Nothing queued yet.</p>
      )}
    </main>
  )
}
