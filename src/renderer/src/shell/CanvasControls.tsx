import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useShell } from './ShellContext'
import { viewport, windowsBounds, type Rect } from './windowManager'

const MAP_W = 180
const MAP_H = 112
const STEP = 1.25

/** The box that holds both the windows and what is on screen, so the map always shows both. */
function union(a: Rect, b: Rect | null): Rect {
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/**
 * A map of the canvas: every free window as a block and the part on screen as a frame. Click or
 * drag on it to look somewhere else.
 */
function Minimap(): React.JSX.Element | null {
  const { state, focused, dispatch, registry } = useShell()
  const dragging = useRef(false)
  const bounds = windowsBounds(state.windows)
  if (!bounds) return null
  const view = viewport(state)
  const world = union(view, bounds)
  const pad = Math.max(world.w, world.h) * 0.06
  const box = { x: world.x - pad, y: world.y - pad, w: world.w + pad * 2, h: world.h + pad * 2 }
  const scale = Math.min(MAP_W / box.w, MAP_H / box.h)
  const ox = (MAP_W - box.w * scale) / 2
  const oy = (MAP_H - box.h * scale) / 2
  const at = (r: Rect): React.CSSProperties => ({
    left: ox + (r.x - box.x) * scale,
    top: oy + (r.y - box.y) * scale,
    width: Math.max(r.w * scale, 2),
    height: Math.max(r.h * scale, 2)
  })

  const lookAt = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const cx = box.x + (e.clientX - r.left - ox) / scale
    const cy = box.y + (e.clientY - r.top - oy) / scale
    dispatch({
      type: 'setCamera',
      camera: { ...state.camera, x: cx - view.w / 2, y: cy - view.h / 2 }
    })
  }

  return (
    <div
      className="minimap"
      role="img"
      aria-label="Map of the desktop"
      style={{ width: MAP_W, height: MAP_H }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        lookAt(e)
      }}
      onPointerMove={(e) => dragging.current && lookAt(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      {state.windows
        .filter((w) => !w.minimized && !w.maximized && !w.snapped)
        .map((w) => (
          <span
            key={w.id}
            className={`minimap-win${w.id === focused ? ' minimap-win-on' : ''}`}
            style={at(w)}
            title={registry.byId.get(w.appId)?.name}
          />
        ))}
      <span className="minimap-view" style={at(view)} />
    </div>
  )
}

/** Zoom out, the zoom level (click for 100%), zoom in, and fit every window on screen. */
export default function CanvasControls(): React.JSX.Element {
  const { state, dispatch } = useShell()
  const zoom = state.camera.zoom
  return (
    <div className="canvas-corner">
      <Minimap />
      <div className="canvas-controls" role="toolbar" aria-label="Canvas">
        <button
          onClick={() => dispatch({ type: 'zoomBy', factor: 1 / STEP })}
          aria-label="Zoom out"
          title="Zoom out (pinch, or ⌘ and scroll)"
        >
          −
        </button>
        <button
          className="canvas-zoom"
          onClick={() => dispatch({ type: 'zoom', zoom: 1 })}
          aria-label="Actual size"
          title="Back to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => dispatch({ type: 'zoomBy', factor: STEP })}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          className="canvas-fit"
          onClick={() => dispatch({ type: 'fitAll' })}
          aria-label="Show all windows"
          title="Show all windows (or double-click the canvas)"
        >
          Fit
        </button>
      </div>
    </div>
  )
}
