import type { Intent } from '@shared/intents'

export const TOPBAR_H = 34
export const DOCK_H = 78
export const TITLEBAR_H = 32
export const DEFAULT_MIN = { w: 320, h: 220 }
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 2
/** Windows never wander further than this from the origin, so a stray drag cannot lose one. */
const CANVAS_LIMIT = 100_000
/** Room left around windows when the camera frames them. */
const FRAME_PAD = 32

export interface Size {
  w: number
  h: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export type SnapSide = 'left' | 'right'

/**
 * The desktop is an endless canvas. A free window's x and y are canvas coordinates; the camera says
 * which canvas point sits at the desktop's top-left corner and how far it is zoomed. Maximized and
 * snapped windows ignore the camera: they are pinned to the screen.
 */
export interface Camera {
  x: number
  y: number
  zoom: number
}

export const HOME_CAMERA: Camera = { x: 0, y: 0, zoom: 1 }

/** Where a window is drawn on screen: its layout box in canvas units, scaled by `scale`. */
export interface Placement extends Rect {
  scale: number
}

export interface WindowState extends Rect {
  id: string
  appId: string
  /** Stacking order; the highest z among visible windows is focused. */
  z: number
  minimized: boolean
  maximized: boolean
  snapped: SnapSide | null
  minSize: Size
  intent?: Intent
  intentNonce?: number
}

export interface WmState {
  windows: WindowState[]
  nextZ: number
  nextId: number
  /** Usable area between the top bar and the dock, in window coordinates. */
  desktop: Size
  camera: Camera
}

export type WmAction =
  | { type: 'open'; appId: string; size: Size; minSize?: Size; intent?: Intent }
  | { type: 'close'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'resize'; id: string; rect: Rect }
  | { type: 'minimize'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'toggleMaximize'; id: string }
  | { type: 'snap'; id: string; side: SnapSide }
  | { type: 'unsnap'; id: string; pointer: { x: number; y: number } }
  | { type: 'setDesktop'; desktop: Size }
  | { type: 'hydrate'; windows: WindowState[]; nextZ: number; nextId: number; camera?: Camera }
  /** Moves the camera by a distance on screen (a drag on the canvas, a two-finger scroll). */
  | { type: 'pan'; dx: number; dy: number }
  /** Zooms keeping one point on screen still (the pointer); the middle of the desktop by default. */
  | { type: 'zoom'; zoom: number; anchor?: { x: number; y: number } }
  /** The same, by a factor of the zoom it is at. */
  | { type: 'zoomBy'; factor: number; anchor?: { x: number; y: number } }
  /**
   * Frames every open window, and anything else on the canvas the shell is told about (the pinned
   * files and areas), or zooms back to 100% where it is when there is nothing.
   */
  | { type: 'fitAll'; extra?: Rect[] }
  /** Pans just enough to bring a window into view. */
  | { type: 'reveal'; id: string }
  | { type: 'setCamera'; camera: Camera }

export function initialState(desktop: Size, camera: Camera = HOME_CAMERA): WmState {
  return { windows: [], nextZ: 1, nextId: 1, desktop, camera }
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

const clampCoord = (n: number): number => Math.min(CANVAS_LIMIT, Math.max(-CANVAS_LIMIT, n))

/** A screen point (desktop-relative) as a canvas point. */
export function toCanvas(p: { x: number; y: number }, camera: Camera): { x: number; y: number } {
  return { x: camera.x + p.x / camera.zoom, y: camera.y + p.y / camera.zoom }
}

/** Where a window is drawn: pinned windows fill their part of the screen, free ones follow the camera. */
export function placement(win: WindowState, state: Pick<WmState, 'desktop' | 'camera'>): Placement {
  if (win.maximized || win.snapped) return { ...effectiveRect(win, state.desktop), scale: 1 }
  const { camera } = state
  return {
    x: (win.x - camera.x) * camera.zoom,
    y: (win.y - camera.y) * camera.zoom,
    w: win.w,
    h: win.h,
    scale: camera.zoom
  }
}

/** The part of the canvas the desktop shows. */
export function viewport(state: Pick<WmState, 'desktop' | 'camera'>): Rect {
  const { camera, desktop } = state
  return { x: camera.x, y: camera.y, w: desktop.w / camera.zoom, h: desktop.h / camera.zoom }
}

/** The camera that shows `rect` whole and centred, never zoomed in past 100%. */
export function frameCamera(rect: Rect, desktop: Size): Camera {
  const zoom = clampZoom(
    Math.min(
      1,
      (desktop.w - FRAME_PAD * 2) / Math.max(rect.w, 1),
      (desktop.h - FRAME_PAD * 2) / Math.max(rect.h, 1)
    )
  )
  return {
    x: rect.x + rect.w / 2 - desktop.w / 2 / zoom,
    y: rect.y + rect.h / 2 - desktop.h / 2 / zoom,
    zoom
  }
}

/**
 * The smallest pan that brings a rect into view at the current zoom: nothing if it is already all
 * on screen. A rect too big for the screen is lined up by its top-left corner, where the window's
 * own controls are.
 */
export function revealCamera(rect: Rect, state: Pick<WmState, 'desktop' | 'camera'>): Camera {
  const view = viewport(state)
  const pad = FRAME_PAD / state.camera.zoom
  const axis = (start: number, size: number, vStart: number, vSize: number): number => {
    if (start >= vStart && start + size <= vStart + vSize) return vStart
    if (size + pad * 2 > vSize) return start - pad
    return start + size / 2 - vSize / 2
  }
  return {
    ...state.camera,
    x: axis(rect.x, rect.w, view.x, view.w),
    y: axis(rect.y, rect.h, view.y, view.h)
  }
}

/** The box around all the rects given (nulls skipped), or null when there are none. */
export function unionRects(rects: (Rect | null)[]): Rect | null {
  const all = rects.filter((r): r is Rect => r !== null)
  if (all.length === 0) return null
  const x = Math.min(...all.map((r) => r.x))
  const y = Math.min(...all.map((r) => r.y))
  const r = Math.max(...all.map((b) => b.x + b.w))
  const b = Math.max(...all.map((b) => b.y + b.h))
  return { x, y, w: r - x, h: b - y }
}

/** The box around every visible free window, or null when there is none. */
export function windowsBounds(windows: WindowState[]): Rect | null {
  const free = windows.filter((w) => !w.minimized && !w.maximized && !w.snapped)
  if (free.length === 0) return null
  const x = Math.min(...free.map((w) => w.x))
  const y = Math.min(...free.map((w) => w.y))
  const r = Math.max(...free.map((w) => w.x + w.w))
  const b = Math.max(...free.map((w) => w.y + w.h))
  return { x, y, w: r - x, h: b - y }
}

/** Where a window is actually drawn: maximized and snapped windows follow the desktop size. */
export function effectiveRect(win: WindowState, desktop: Size): Rect {
  if (win.maximized) return { x: 0, y: 0, w: desktop.w, h: desktop.h }
  if (win.snapped) {
    const half = Math.floor(desktop.w / 2)
    return win.snapped === 'left'
      ? { x: 0, y: 0, w: half, h: desktop.h }
      : { x: half, y: 0, w: desktop.w - half, h: desktop.h }
  }
  return { x: win.x, y: win.y, w: win.w, h: win.h }
}

/** The focused window is the visible one with the highest z. */
export function focusedId(state: WmState): string | null {
  let top: WindowState | null = null
  for (const w of state.windows) {
    if (!w.minimized && (!top || w.z > top.z)) top = w
  }
  return top?.id ?? null
}

/**
 * Canvas bounds for a window dragged out of a snapped or maximized state: its normal size, with the
 * middle of its title bar under the pointer (a screen point).
 */
export function unsnapRect(
  win: WindowState,
  pointer: { x: number; y: number },
  camera: Camera
): Rect {
  const p = toCanvas(pointer, camera)
  return {
    x: Math.round(p.x - win.w / 2),
    y: Math.round(p.y - TITLEBAR_H / 2),
    w: win.w,
    h: win.h
  }
}

function update(state: WmState, id: string, fn: (w: WindowState) => WindowState): WmState {
  return { ...state, windows: state.windows.map((w) => (w.id === id ? fn(w) : w)) }
}

function bringToFront(state: WmState, id: string): WmState {
  const next = update(state, id, (w) => ({ ...w, z: state.nextZ }))
  return { ...next, nextZ: state.nextZ + 1 }
}

const GAP = 40

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Where a new window goes. Like a card added to a board: in the middle of what is on screen if
 * that spot is clear, otherwise to the right of the windows already there, level with the middle
 * of the screen. The camera then pans to it.
 */
function placeNew(state: WmState, size: Size): { x: number; y: number } {
  const view = viewport(state)
  const inset = 16 / state.camera.zoom
  const spot = {
    x: Math.round(view.x + Math.max((view.w - size.w) / 2, inset)),
    y: Math.round(view.y + Math.max((view.h - size.h) / 2, inset)),
    ...size
  }
  const free = state.windows.filter((w) => !w.minimized && !w.maximized && !w.snapped)
  if (!free.some((w) => overlaps(w, spot))) return spot
  // The windows level with the spot form a row; the new one goes at its end.
  const row = free.filter((w) => w.y < spot.y + spot.h && spot.y < w.y + w.h)
  const right = Math.max(...(row.length > 0 ? row : free).map((w) => w.x + w.w))
  return { x: Math.round(right + GAP), y: spot.y }
}

const sanitizeCamera = (c: Camera | undefined): Camera =>
  c && [c.x, c.y].every(Number.isFinite)
    ? { x: clampCoord(c.x), y: clampCoord(c.y), zoom: clampZoom(c.zoom) }
    : HOME_CAMERA

export function wmReducer(state: WmState, action: WmAction): WmState {
  switch (action.type) {
    case 'open': {
      const existing = state.windows.find((w) => w.appId === action.appId)
      if (existing) {
        let next = update(state, existing.id, (w) => ({
          ...w,
          minimized: false,
          ...(action.intent ? { intent: action.intent, intentNonce: (w.intentNonce ?? 0) + 1 } : {})
        }))
        next = bringToFront(next, existing.id)
        // Somewhere off on the canvas is as good as closed; bring it into view.
        return wmReducer(next, { type: 'reveal', id: existing.id })
      }
      const minSize = action.minSize ?? DEFAULT_MIN
      const w = Math.max(minSize.w, Math.min(action.size.w, state.desktop.w))
      const h = Math.max(minSize.h, Math.min(action.size.h, state.desktop.h))
      const origin = placeNew(state, { w, h })
      const win: WindowState = {
        id: `win-${state.nextId}`,
        appId: action.appId,
        ...origin,
        w,
        h,
        z: state.nextZ,
        minimized: false,
        maximized: false,
        snapped: null,
        minSize,
        ...(action.intent ? { intent: action.intent, intentNonce: 1 } : {})
      }
      return wmReducer(
        {
          ...state,
          windows: [...state.windows, win],
          nextId: state.nextId + 1,
          nextZ: state.nextZ + 1
        },
        { type: 'reveal', id: win.id }
      )
    }
    case 'close':
      return { ...state, windows: state.windows.filter((w) => w.id !== action.id) }
    case 'focus':
      return bringToFront(state, action.id)
    case 'move':
      return update(state, action.id, (w) => {
        if (w.maximized || w.snapped) return w
        return { ...w, x: clampCoord(Math.round(action.x)), y: clampCoord(Math.round(action.y)) }
      })
    case 'resize':
      return update(state, action.id, (w) => {
        const r = action.rect
        return {
          ...w,
          x: clampCoord(Math.round(r.x)),
          y: clampCoord(Math.round(r.y)),
          w: Math.round(Math.max(w.minSize.w, r.w)),
          h: Math.round(Math.max(w.minSize.h, r.h)),
          maximized: false,
          snapped: null
        }
      })
    case 'minimize':
      return update(state, action.id, (w) => ({ ...w, minimized: true }))
    case 'restore': {
      const next = update(state, action.id, (w) => ({ ...w, minimized: false }))
      return wmReducer(bringToFront(next, action.id), { type: 'reveal', id: action.id })
    }
    case 'toggleMaximize': {
      const next = update(state, action.id, (w) => ({
        ...w,
        maximized: !w.maximized,
        snapped: null,
        minimized: false
      }))
      return bringToFront(next, action.id)
    }
    case 'snap': {
      const next = update(state, action.id, (w) => ({
        ...w,
        snapped: w.snapped === action.side && !w.maximized ? null : action.side,
        maximized: false,
        minimized: false
      }))
      return bringToFront(next, action.id)
    }
    case 'unsnap':
      return update(state, action.id, (w) => ({
        ...w,
        ...unsnapRect(w, action.pointer, state.camera),
        maximized: false,
        snapped: null
      }))
    case 'setDesktop':
      // Windows stay where they are on the canvas; only the pinned ones follow the new size.
      return { ...state, desktop: action.desktop }
    case 'hydrate':
      return {
        ...state,
        nextZ: action.nextZ,
        nextId: action.nextId,
        windows: action.windows,
        camera: sanitizeCamera(action.camera)
      }
    case 'pan': {
      const { camera } = state
      return {
        ...state,
        camera: {
          ...camera,
          x: clampCoord(camera.x - action.dx / camera.zoom),
          y: clampCoord(camera.y - action.dy / camera.zoom)
        }
      }
    }
    case 'zoom': {
      const zoom = clampZoom(action.zoom)
      const anchor = action.anchor ?? { x: state.desktop.w / 2, y: state.desktop.h / 2 }
      // The canvas point under the anchor stays under it.
      const p = toCanvas(anchor, state.camera)
      return {
        ...state,
        camera: {
          x: clampCoord(p.x - anchor.x / zoom),
          y: clampCoord(p.y - anchor.y / zoom),
          zoom
        }
      }
    }
    case 'zoomBy':
      return wmReducer(state, {
        type: 'zoom',
        zoom: state.camera.zoom * action.factor,
        anchor: action.anchor
      })
    case 'fitAll': {
      const bounds = unionRects([windowsBounds(state.windows), ...(action.extra ?? [])])
      if (!bounds) return wmReducer(state, { type: 'zoom', zoom: 1 })
      return { ...state, camera: frameCamera(bounds, state.desktop) }
    }
    case 'reveal': {
      const win = state.windows.find((w) => w.id === action.id)
      if (!win || win.minimized || win.maximized || win.snapped) return state
      const camera = revealCamera(win, state)
      return camera.x === state.camera.x && camera.y === state.camera.y
        ? state
        : { ...state, camera }
    }
    case 'setCamera':
      return { ...state, camera: sanitizeCamera(action.camera) }
  }
}
