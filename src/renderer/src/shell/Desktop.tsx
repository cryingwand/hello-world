import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import CanvasControls from './CanvasControls'
import { useShell } from './ShellContext'
import WindowFrame from './WindowFrame'

/** Spacing of the canvas dots at 100%. */
const GRID = 24

/** A pinch (or Ctrl and the wheel) of this many pixels doubles or halves the zoom, roughly. */
const ZOOM_SPEED = 0.01

/** True for a pointer or wheel event on the canvas itself rather than inside a window or a control. */
const onCanvas = (target: EventTarget | null): boolean =>
  target instanceof Element && !target.closest('.window, .canvas-corner')

/**
 * The desktop is an endless canvas, like a whiteboard. Drag empty space or scroll with two fingers
 * to move around it; pinch (or hold Ctrl or ⌘ and scroll) to zoom. Windows are cards on it.
 */
export default function Desktop(): React.JSX.Element {
  const { state, focused, registry, dispatch } = useShell()
  const ref = useRef<HTMLElement>(null)
  const pan = useRef<{ x: number; y: number } | null>(null)

  // A wheel listener has to be registered by hand to be allowed to stop the page's own zoom.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      // A pinch on a trackpad arrives as a wheel event with Ctrl held.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = Math.max(-50, Math.min(50, e.deltaY))
        const box = el.getBoundingClientRect()
        dispatch({
          type: 'zoomBy',
          factor: Math.exp(-delta * ZOOM_SPEED),
          anchor: { x: e.clientX - box.left, y: e.clientY - box.top }
        })
        return
      }
      // Inside a window, scrolling scrolls the window.
      if (!onCanvas(e.target)) return
      e.preventDefault()
      const lines = e.deltaMode === 1 ? 16 : 1
      dispatch({
        type: 'pan',
        dx: -(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * lines,
        dy: -(e.shiftKey && !e.deltaX ? 0 : e.deltaY) * lines
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [dispatch])

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    // The middle button pans from anywhere, the main button from empty canvas.
    if (!(e.button === 1 || (e.button === 0 && onCanvas(e.target)))) return
    e.preventDefault()
    pan.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.classList.add('desktop-panning')
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const p = pan.current
    if (!p) return
    dispatch({ type: 'pan', dx: e.clientX - p.x, dy: e.clientY - p.y })
    pan.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    if (!pan.current) return
    pan.current = null
    e.currentTarget.classList.remove('desktop-panning')
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const { camera } = state
  // Dots stay roughly the same distance apart on screen however far out the canvas is zoomed.
  let grid = GRID * camera.zoom
  while (grid < 14) grid *= 2
  const style = {
    '--grid': `${grid}px`,
    '--grid-x': `${-camera.x * camera.zoom}px`,
    '--grid-y': `${-camera.y * camera.zoom}px`
  } as React.CSSProperties

  return (
    <main
      ref={ref}
      className="desktop"
      style={style}
      aria-label="Desktop"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => onCanvas(e.target) && dispatch({ type: 'fitAll' })}
    >
      {state.windows.map((win) => {
        const app = registry.byId.get(win.appId)
        return app ? (
          <WindowFrame key={win.id} win={win} app={app} focused={win.id === focused} />
        ) : null
      })}
      <CanvasControls />
    </main>
  )
}
