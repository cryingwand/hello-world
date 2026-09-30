import type { Intent } from '@shared/intents'

export const TOPBAR_H = 34
export const DOCK_H = 78
export const TITLEBAR_H = 32
export const DEFAULT_MIN = { w: 320, h: 220 }

export interface Size {
  w: number
  h: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export type SnapSide = 'left' | 'right'

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
  | { type: 'hydrate'; windows: WindowState[]; nextZ: number; nextId: number }

export function initialState(desktop: Size): WmState {
  return { windows: [], nextZ: 1, nextId: 1, desktop }
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
 * Keep a window reachable. The left edge never leaves the screen (the close, minimize and maximize
 * buttons live there); on the right, at least 120px stays visible. The title bar stays on screen.
 */
export function clampRect(rect: Rect, desktop: Size): Rect {
  const w = Math.min(rect.w, Math.max(desktop.w, 0))
  const h = Math.min(rect.h, Math.max(desktop.h, 0))
  const keep = Math.min(120, w)
  const x = Math.min(Math.max(rect.x, 0), Math.max(desktop.w - keep, 0))
  const y = Math.min(Math.max(rect.y, 0), Math.max(desktop.h - TITLEBAR_H, 0))
  return { x, y, w, h }
}

/** Normal bounds for a window dragged out of a snapped or maximized state. */
export function unsnapRect(
  win: WindowState,
  pointer: { x: number; y: number },
  desktop: Size
): Rect {
  return clampRect(
    {
      x: pointer.x - Math.round(win.w / 2),
      y: pointer.y - Math.round(TITLEBAR_H / 2),
      w: win.w,
      h: win.h
    },
    desktop
  )
}

function update(state: WmState, id: string, fn: (w: WindowState) => WindowState): WmState {
  return { ...state, windows: state.windows.map((w) => (w.id === id ? fn(w) : w)) }
}

function bringToFront(state: WmState, id: string): WmState {
  const next = update(state, id, (w) => ({ ...w, z: state.nextZ }))
  return { ...next, nextZ: state.nextZ + 1 }
}

/** Cascade new windows so they never open exactly on top of each other. */
function cascadeOrigin(state: WmState, size: Size): { x: number; y: number } {
  const step = 32
  const n = state.windows.filter((w) => !w.maximized && !w.snapped).length
  const x = 40 + ((n * step) % Math.max(state.desktop.w - size.w - 80, step))
  const y = 24 + ((n * step) % Math.max(state.desktop.h - size.h - 48, step))
  return { x, y }
}

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
        return next
      }
      const minSize = action.minSize ?? DEFAULT_MIN
      const w = Math.max(minSize.w, Math.min(action.size.w, state.desktop.w))
      const h = Math.max(minSize.h, Math.min(action.size.h, state.desktop.h))
      const origin = cascadeOrigin(state, { w, h })
      const win: WindowState = {
        id: `win-${state.nextId}`,
        appId: action.appId,
        ...clampRect({ ...origin, w, h }, state.desktop),
        z: state.nextZ,
        minimized: false,
        maximized: false,
        snapped: null,
        minSize,
        ...(action.intent ? { intent: action.intent, intentNonce: 1 } : {})
      }
      return {
        ...state,
        windows: [...state.windows, win],
        nextId: state.nextId + 1,
        nextZ: state.nextZ + 1
      }
    }
    case 'close':
      return { ...state, windows: state.windows.filter((w) => w.id !== action.id) }
    case 'focus':
      return bringToFront(state, action.id)
    case 'move':
      return update(state, action.id, (w) => {
        if (w.maximized || w.snapped) return w
        return { ...w, ...clampRect({ x: action.x, y: action.y, w: w.w, h: w.h }, state.desktop) }
      })
    case 'resize':
      return update(state, action.id, (w) => {
        const r = action.rect
        const rect = { ...r, w: Math.max(w.minSize.w, r.w), h: Math.max(w.minSize.h, r.h) }
        return { ...w, ...clampRect(rect, state.desktop), maximized: false, snapped: null }
      })
    case 'minimize':
      return update(state, action.id, (w) => ({ ...w, minimized: true }))
    case 'restore': {
      const next = update(state, action.id, (w) => ({ ...w, minimized: false }))
      return bringToFront(next, action.id)
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
        ...unsnapRect(w, action.pointer, state.desktop),
        maximized: false,
        snapped: null
      }))
    case 'setDesktop': {
      const desktop = action.desktop
      return {
        ...state,
        desktop,
        windows: state.windows.map((w) => ({ ...w, ...clampRect(w, desktop) }))
      }
    }
    case 'hydrate':
      return {
        ...state,
        nextZ: action.nextZ,
        nextId: action.nextId,
        windows: action.windows.map((w) => ({ ...w, ...clampRect(w, state.desktop) }))
      }
  }
}
