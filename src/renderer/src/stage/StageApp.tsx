import { useEffect, useState } from 'react'
import type { StageTool, StageView } from '@shared/stage'
import { formatClock, timerRemaining, type TimerState } from '@shared/tools'
import { PAPER_CSS } from '../apps/files/paper'

/**
 * A Stage size token as a length. The Word page is drawn in a sandboxed frame, which cannot see this
 * window's custom properties, so the value is handed over.
 */
const stageSize = (token: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback

/** Page text sized for a room, not a desk: scaled to the height of the display. */
const stageDocxCss = (): string =>
  `body{font-size:${stageSize('--stage-body', '3.7vh')} !important;padding:5vh 7vw !important}`

/**
 * Text that is sized to fit (a long name, a big group) never goes below the Stage's smallest size.
 * `min` is what fits; the floor wins when nothing does.
 */
const fit = (...sizes: string[]): string => `max(var(--stage-caption), min(${sizes.join(', ')}))`

/** The timer in the corner, counted down here from its end time so it never drifts from the teacher's. */
function StageTimer({ timer }: { timer: TimerState }): React.JSX.Element {
  // Mounted afresh for every change (see its key below), so this first reading is never stale.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (timer.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [timer])
  const left = timerRemaining(timer, now)
  const over = timer.status === 'done' || (timer.status === 'running' && left <= 0)
  // A finished timer inverts its plate and says so in words. It does not flash or turn red.
  return (
    <div
      className={`stage-timer${over ? ' stage-timer-done' : ''}${timer.status === 'paused' ? ' stage-timer-paused' : ''}`}
      role="timer"
    >
      {over ? 'Time' : formatClock(left)}
    </div>
  )
}

/** About how wide a character of the Stage's serif is, in ems, to size text to fit a width. */
const CHAR_EM = 0.54

/** Height left for the groups under the docked timer (see `.stage-groups` padding), with a margin. */
const GROUPS_ROOM_VH = 73

/** A picked name or the groups, full screen, sized so the longest name and the biggest group fit. */
function StageToolView({ tool }: { tool: StageTool }): React.JSX.Element {
  if (tool.kind === 'picker') {
    // As big as the picked-name size, unless the name is too long to fit across the screen on one line.
    const across = 88 / (CHAR_EM * tool.name.length)
    return (
      <p
        key={tool.name}
        className="stage-pick"
        style={{ fontSize: fit('var(--stage-name)', `${across}vw`) }}
      >
        {tool.name}
      </p>
    )
  }
  const { groups } = tool
  const longest = Math.max(...groups.map((g) => g.length))
  const widest = Math.max(8, ...groups.flat().map((n) => n.length))
  // Try one to eight columns and keep the one that gives the biggest text. Height: each row of cards
  // is a heading (about two lines) and its names, in the GROUPS_ROOM_VH left under the timer. Width: the
  // longest name on one line in its column. Compared on a 16:10 screen, the common projector shape.
  let best = { cols: 1, down: 0, across: 0, size: 0 }
  for (let cols = 1; cols <= Math.min(8, groups.length); cols++) {
    const rows = Math.ceil(groups.length / cols)
    // The room under the timer, less the 2.5vh gap between rows.
    const down = Math.min(5, (GROUPS_ROOM_VH - 2.5 * (rows - 1)) / (rows * (longest * 1.35 + 2)))
    const across = (88 / cols - 2) / (CHAR_EM * widest)
    const size = Math.min(down, across * 1.6)
    if (size > best.size) best = { cols, down, across, size }
  }
  return (
    <div
      className="stage-groups"
      style={{
        fontSize: fit(`${best.down}vh`, `${best.across}vw`),
        gridTemplateColumns: `repeat(${best.cols}, minmax(0, 1fr))`
      }}
    >
      {groups.map((g, i) => (
        <section key={i} className="stage-group">
          <h2>Group {i + 1}</h2>
          <ul>
            {g.map((name, j) => (
              <li key={j}>{name}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

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
          srcDoc={`<!doctype html><meta charset="utf-8"><style>${PAPER_CSS}${stageDocxCss()}</style><body>${c.html}</body>`}
        />
      )}
      {c?.kind === 'text' && c.text !== undefined && <pre className="stage-text">{c.text}</pre>}
      {view?.tool && <StageToolView tool={view.tool} />}
      {view && view.active && !c && !view.tool && !view.blanked && view.count === 0 && (
        <p className="stage-message">Nothing queued yet.</p>
      )}
      {view?.timer && (
        <StageTimer
          key={`${view.timer.status}:${view.timer.endsAt}:${view.timer.remainingMs}`}
          timer={view.timer}
        />
      )}
    </main>
  )
}
