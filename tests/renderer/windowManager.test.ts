import { describe, expect, it } from 'vitest'
import {
  clampRect,
  effectiveRect,
  focusedId,
  initialState,
  wmReducer,
  type WmAction,
  type WmState
} from '@renderer/shell/windowManager'

const desktop = { w: 1200, h: 700 }
const open = (s: WmState, appId: string, extra: Partial<WmAction> = {}): WmState =>
  wmReducer(s, { type: 'open', appId, size: { w: 600, h: 400 }, ...extra } as WmAction)

describe('window manager', () => {
  it('opens a window and focuses it', () => {
    const s = open(initialState(desktop), 'a')
    expect(s.windows).toHaveLength(1)
    expect(focusedId(s)).toBe(s.windows[0].id)
  })

  it('reuses the window when an app is opened again and restores it if minimized', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'minimize', id })
    expect(focusedId(s)).toBeNull()
    s = open(s, 'a')
    expect(s.windows).toHaveLength(1)
    expect(s.windows[0].minimized).toBe(false)
    expect(focusedId(s)).toBe(id)
  })

  it('cascades new windows so they do not stack exactly', () => {
    let s = open(initialState(desktop), 'a')
    s = open(s, 'b')
    expect(s.windows[1].x).not.toBe(s.windows[0].x)
    expect(s.windows[1].y).not.toBe(s.windows[0].y)
  })

  it('focus raises a window above the others', () => {
    let s = open(open(initialState(desktop), 'a'), 'b')
    const [a, b] = s.windows.map((w) => w.id)
    expect(focusedId(s)).toBe(b)
    s = wmReducer(s, { type: 'focus', id: a })
    expect(focusedId(s)).toBe(a)
  })

  it('minimizing the focused window hands focus to the next visible one', () => {
    let s = open(open(initialState(desktop), 'a'), 'b')
    const [a, b] = s.windows.map((w) => w.id)
    s = wmReducer(s, { type: 'minimize', id: b })
    expect(focusedId(s)).toBe(a)
    s = wmReducer(s, { type: 'restore', id: b })
    expect(focusedId(s)).toBe(b)
  })

  it('closes windows', () => {
    let s = open(initialState(desktop), 'a')
    s = wmReducer(s, { type: 'close', id: s.windows[0].id })
    expect(s.windows).toHaveLength(0)
  })

  it('moves within bounds and keeps the title bar reachable', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'move', id, x: 100, y: 120 })
    expect(s.windows[0]).toMatchObject({ x: 100, y: 120 })
    s = wmReducer(s, { type: 'move', id, x: 5000, y: -400 })
    expect(s.windows[0].x).toBeLessThanOrEqual(desktop.w - 120)
    expect(s.windows[0].y).toBe(0)
    s = wmReducer(s, { type: 'move', id, x: -5000, y: 9000 })
    expect(s.windows[0].x).toBe(0)
    expect(s.windows[0].y).toBeLessThanOrEqual(desktop.h - 32)
  })

  it('resizes but never below the minimum size', () => {
    let s = open(initialState(desktop), 'a', { minSize: { w: 400, h: 300 } })
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'resize', id, rect: { x: 50, y: 50, w: 100, h: 100 } })
    expect(s.windows[0]).toMatchObject({ w: 400, h: 300 })
  })

  it('toggles maximize using the full desktop and restores the previous bounds', () => {
    let s = open(initialState(desktop), 'a')
    const before = { ...s.windows[0] }
    const id = before.id
    s = wmReducer(s, { type: 'toggleMaximize', id })
    expect(effectiveRect(s.windows[0], desktop)).toEqual({ x: 0, y: 0, ...desktop })
    s = wmReducer(s, { type: 'toggleMaximize', id })
    expect(effectiveRect(s.windows[0], desktop)).toEqual({
      x: before.x,
      y: before.y,
      w: before.w,
      h: before.h
    })
  })

  it('snaps left and right into halves, and un-snaps on repeat', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'snap', id, side: 'left' })
    expect(effectiveRect(s.windows[0], desktop)).toEqual({ x: 0, y: 0, w: 600, h: 700 })
    s = wmReducer(s, { type: 'snap', id, side: 'right' })
    expect(effectiveRect(s.windows[0], desktop)).toEqual({ x: 600, y: 0, w: 600, h: 700 })
    s = wmReducer(s, { type: 'snap', id, side: 'right' })
    expect(s.windows[0].snapped).toBeNull()
  })

  it('snapped halves cover an odd-width desktop without a gap', () => {
    const odd = { w: 1201, h: 700 }
    let s = open(initialState(odd), 'a')
    const id = s.windows[0].id
    const left = effectiveRect(wmReducer(s, { type: 'snap', id, side: 'left' }).windows[0], odd)
    s = wmReducer(s, { type: 'snap', id, side: 'right' })
    const right = effectiveRect(s.windows[0], odd)
    expect(left.x + left.w).toBe(right.x)
    expect(right.x + right.w).toBe(odd.w)
  })

  it('un-snaps under the pointer when dragged out of a snap', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    const w = s.windows[0].w
    s = wmReducer(s, { type: 'snap', id, side: 'left' })
    s = wmReducer(s, { type: 'unsnap', id, pointer: { x: 700, y: 10 } })
    expect(s.windows[0].snapped).toBeNull()
    expect(s.windows[0].x).toBe(700 - Math.round(w / 2))
  })

  it('ignores move on a maximized window', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'toggleMaximize', id })
    const x = s.windows[0].x
    s = wmReducer(s, { type: 'move', id, x: 10, y: 10 })
    expect(s.windows[0].x).toBe(x)
  })

  it('fits windows entirely inside the desktop when it shrinks', () => {
    let s = open(initialState(desktop), 'a')
    s = wmReducer(s, { type: 'move', id: s.windows[0].id, x: 500, y: 250 })
    s = wmReducer(s, { type: 'setDesktop', desktop: { w: 500, h: 300 } })
    const w = s.windows[0]
    expect(w.w).toBeLessThanOrEqual(500)
    expect(w.h).toBeLessThanOrEqual(300)
    expect(w.x).toBeGreaterThanOrEqual(0)
    expect(w.y).toBeGreaterThanOrEqual(0)
    expect(w.x + w.w).toBeLessThanOrEqual(500)
    expect(w.y + w.h).toBeLessThanOrEqual(300)
  })

  it('a window that already fits is left where it is when the desktop changes', () => {
    let s = open(initialState(desktop), 'a')
    s = wmReducer(s, { type: 'move', id: s.windows[0].id, x: 100, y: 80 })
    s = wmReducer(s, { type: 'setDesktop', desktop: { w: 1600, h: 900 } })
    expect(s.windows[0]).toMatchObject({ x: 100, y: 80, w: 600, h: 400 })
  })

  it('restored layouts are fitted to the current desktop', () => {
    let s = open(initialState(desktop), 'a')
    const saved = { ...s.windows[0], x: 1100, y: 600, w: 1000, h: 650 }
    s = wmReducer(initialState({ w: 800, h: 500 }), {
      type: 'hydrate',
      windows: [saved],
      nextZ: 5,
      nextId: 5
    })
    expect(s.windows[0].x + s.windows[0].w).toBeLessThanOrEqual(800)
    expect(s.windows[0].y + s.windows[0].h).toBeLessThanOrEqual(500)
  })

  it('routes an intent into the window and bumps the nonce even for an identical intent', () => {
    const intent = { type: 'open-student', studentId: 4 } as const
    let s = open(initialState(desktop), 'a', { intent })
    expect(s.windows[0]).toMatchObject({ intent, intentNonce: 1 })
    s = open(s, 'a', { intent })
    expect(s.windows[0].intentNonce).toBe(2)
  })

  it('clampRect never returns a window larger than the desktop', () => {
    const r = clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, desktop)
    expect(r.w).toBe(desktop.w)
    expect(r.h).toBe(desktop.h)
  })
})
