import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PATHS_TYPE, type DraggedPath } from '@apps/files/FolderBrowser'
import CanvasControls from './CanvasControls'
import DeskLayer, { canvasPoint, type CanvasClick } from './DeskLayer'
import { useShell } from './ShellContext'
import WindowFrame from './WindowFrame'

/** Spacing of the canvas dots at 100%. */
const GRID = 24

/** A pinch (or Ctrl and the wheel) of this many pixels doubles or halves the zoom, roughly. */
const ZOOM_SPEED = 0.01

/**
 * True for an event on the canvas itself rather than on a window, a control or a pinned thing.
 * React passes events from a portal (a dialog, a menu) up to the desktop even though the dialog is not
 * inside it on the page, so the target must really be inside the desktop: otherwise a click on a
 * dialog's button would start a pan and never reach the button.
 */
const onCanvas = (e: { target: EventTarget | null; currentTarget: Element }): boolean =>
  inDesktop(e) &&
  !(e.target as Element).closest('.window, .canvas-corner, .desk-item, .context-menu')

/** The event happened inside the desktop on the page, not in a dialog portaled out of it. */
const inDesktop = (e: { target: EventTarget | null; currentTarget: Element }): boolean =>
  e.target instanceof Element && e.currentTarget.contains(e.target)

/** Scrolling pans the canvas except inside a window or a pinned folder's list. */
const scrollsCanvas = (target: EventTarget | null): boolean =>
  target instanceof Element && !target.closest('.window, .canvas-corner, .desk-scroll')

/**
 * The desktop is an endless canvas, like a whiteboard. Drag empty space or scroll with two fingers
 * to move around it; pinch (or hold Ctrl or ⌘ and scroll) to zoom. Windows are cards on it.
 */
export default function Desktop(): React.JSX.Element {
  const { state, focused, registry, dispatch, space, fitAll } = useShell()
  const ref = useRef<HTMLElement>(null)
  // The everyday desktop holds the teacher's own arrangement; the Vault's canvas holds windows only.
  const hasDesk = space === 'launcher'
  const [canvasClick, setCanvasClick] = useState<CanvasClick | null>(null)
  const pointAt = (clientX: number, clientY: number): { x: number; y: number } =>
    canvasPoint(clientX, clientY, ref.current!.getBoundingClientRect(), state.camera)
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
      if (!scrollsCanvas(e.target)) return
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
    if (!(e.button === 1 ? inDesktop(e) : e.button === 0 && onCanvas(e))) return
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
      onDoubleClick={(e) => onCanvas(e) && fitAll()}
      onContextMenu={(e) => {
        if (!hasDesk || !onCanvas(e)) return
        e.preventDefault()
        setCanvasClick({
          clientX: e.clientX,
          clientY: e.clientY,
          ...pointAt(e.clientX, e.clientY),
          nonce: (canvasClick?.nonce ?? 0) + 1
        })
      }}
      // Files dragged out of Files are pinned where they land.
      onDragOver={(e) => {
        if (hasDesk && e.dataTransfer.types.includes(PATHS_TYPE) && onCanvas(e)) e.preventDefault()
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(PATHS_TYPE)
        if (!hasDesk || !raw || !onCanvas(e)) return
        e.preventDefault()
        const at = pointAt(e.clientX, e.clientY)
        ;(JSON.parse(raw) as DraggedPath[]).slice(0, 40).forEach((d, i) => {
          window.api.desk
            .pin({
              kind: d.isDir ? 'folder' : 'file',
              path: d.path,
              x: at.x - 60 + i * 24,
              y: at.y - 50 + i * 24
            })
            .catch((err: unknown) => console.error('[desk] pin failed:', err))
        })
      }}
    >
      {hasDesk && <DeskLayer canvasClick={canvasClick} />}
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
