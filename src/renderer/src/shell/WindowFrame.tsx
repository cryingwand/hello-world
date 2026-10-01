import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import Icon from '@renderer/components/Icon'
import type { AppManifest } from '@apps/types'
import { useShell } from './ShellContext'
import { effectiveRect, unsnapRect, TOPBAR_H, type Rect, type WindowState } from './windowManager'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const DRAG_THRESHOLD = 4
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function resized(
  start: Rect,
  edge: Edge,
  dx: number,
  dy: number,
  min: { w: number; h: number }
): Rect {
  let { x, y, w, h } = start
  if (edge.includes('e')) w = Math.max(min.w, start.w + dx)
  if (edge.includes('s')) h = Math.max(min.h, start.h + dy)
  if (edge.includes('w')) {
    w = Math.max(min.w, start.w - dx)
    x = start.x + (start.w - w)
  }
  if (edge.includes('n')) {
    h = Math.max(min.h, start.h - dy)
    y = start.y + (start.h - h)
  }
  return { x, y, w, h }
}

export default function WindowFrame({
  win,
  app,
  focused
}: {
  win: WindowState
  app: AppManifest
  focused: boolean
}): React.JSX.Element {
  const { state, dispatch } = useShell()
  const drag = useRef<{
    px: number
    py: number
    ox: number
    oy: number
    /** Snapped or maximized windows only leave that state once the pointer really drags. */
    pendingUnsnap: boolean
  } | null>(null)
  const rect = effectiveRect(win, state.desktop)
  const Body = app.component
  const hidden = win.minimized

  const onTitleDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    dispatch({ type: 'focus', id: win.id })
    drag.current = {
      px: e.clientX,
      py: e.clientY,
      ox: win.x,
      oy: win.y,
      pendingUnsnap: win.maximized || !!win.snapped
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onTitleMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    if (d.pendingUnsnap) {
      if (Math.hypot(e.clientX - d.px, e.clientY - d.py) < DRAG_THRESHOLD) return
      const pointer = { x: e.clientX, y: e.clientY - TOPBAR_H }
      const r = unsnapRect(win, pointer, state.desktop)
      dispatch({ type: 'unsnap', id: win.id, pointer })
      drag.current = { px: e.clientX, py: e.clientY, ox: r.x, oy: r.y, pendingUnsnap: false }
      return
    }
    dispatch({ type: 'move', id: win.id, x: d.ox + e.clientX - d.px, y: d.oy + e.clientY - d.py })
  }
  const onTitleUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const startResize = (edge: Edge) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    dispatch({ type: 'focus', id: win.id })
    const start = effectiveRect(win, state.desktop)
    const sx = e.clientX
    const sy = e.clientY
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void =>
      dispatch({
        type: 'resize',
        id: win.id,
        rect: resized(start, edge, ev.clientX - sx, ev.clientY - sy, win.minSize)
      })
    const up = (ev: PointerEvent): void => {
      target.releasePointerCapture(ev.pointerId)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  return (
    <section
      className={`window${focused ? ' window-focused' : ''}${win.maximized ? ' window-max' : ''}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: win.z,
        display: hidden ? 'none' : undefined
      }}
      data-app={app.id}
      aria-label={app.name}
      onPointerDownCapture={() => !focused && dispatch({ type: 'focus', id: win.id })}
    >
      <div
        className="titlebar"
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onPointerCancel={onTitleUp}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button'))
            dispatch({ type: 'toggleMaximize', id: win.id })
        }}
      >
        <div className="traffic">
          <button
            className="tl tl-close"
            aria-label="Close"
            onClick={() => dispatch({ type: 'close', id: win.id })}
          >
            <Icon name="close" size={9} />
          </button>
          <button
            className="tl tl-min"
            aria-label="Minimize"
            onClick={() => dispatch({ type: 'minimize', id: win.id })}
          >
            <Icon name="minimize" size={9} />
          </button>
          <button
            className="tl tl-max"
            aria-label="Maximize"
            onClick={() => dispatch({ type: 'toggleMaximize', id: win.id })}
          >
            <Icon name="maximize" size={9} />
          </button>
        </div>
        <span className="title">{app.name}</span>
        <div className="snap-btns">
          <button
            aria-label="Snap left"
            title="Snap left"
            onClick={() => dispatch({ type: 'snap', id: win.id, side: 'left' })}
          >
            <Icon name="snap-left" size={14} />
          </button>
          <button
            aria-label="Snap right"
            title="Snap right"
            onClick={() => dispatch({ type: 'snap', id: win.id, side: 'right' })}
          >
            <Icon name="snap-right" size={14} />
          </button>
        </div>
      </div>
      <div className="window-body">
        <Body windowId={win.id} intent={win.intent} intentNonce={win.intentNonce} />
      </div>
      {!win.maximized &&
        EDGES.map((edge) => (
          <div key={edge} className={`resize resize-${edge}`} onPointerDown={startResize(edge)} />
        ))}
    </section>
  )
}
