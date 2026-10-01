import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  effectiveRect,
  focusedId,
  initialState,
  placement,
  viewport,
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

  it('puts a new window beside the others, not on top of them, and pans to it', () => {
    let s = open(initialState(desktop), 'a')
    s = open(s, 'b')
    s = open(s, 'c')
    const [a, b, c] = s.windows
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.w)
    expect(c.x).toBeGreaterThanOrEqual(b.x + b.w)
    expect(b.y).toBe(a.y)
    const view = viewport(s)
    expect(c.x).toBeGreaterThanOrEqual(view.x)
    expect(c.x + c.w).toBeLessThanOrEqual(view.x + view.w)
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

  it('moves freely on the canvas, even off screen', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'move', id, x: 100, y: 120 })
    expect(s.windows[0]).toMatchObject({ x: 100, y: 120 })
    s = wmReducer(s, { type: 'move', id, x: 5000, y: -400 })
    expect(s.windows[0]).toMatchObject({ x: 5000, y: -400 })
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

  it('leaves windows where they are on the canvas when the desktop changes size', () => {
    let s = open(initialState(desktop), 'a')
    s = wmReducer(s, { type: 'move', id: s.windows[0].id, x: 500, y: 250 })
    s = wmReducer(s, { type: 'setDesktop', desktop: { w: 500, h: 300 } })
    expect(s.windows[0]).toMatchObject({ x: 500, y: 250, w: 600, h: 400 })
    expect(s.desktop).toEqual({ w: 500, h: 300 })
  })

  it('restores a saved layout where it was, with its camera', () => {
    let s = open(initialState(desktop), 'a')
    const saved = { ...s.windows[0], x: 1100, y: 600, w: 1000, h: 650 }
    s = wmReducer(initialState({ w: 800, h: 500 }), {
      type: 'hydrate',
      windows: [saved],
      nextZ: 5,
      nextId: 5,
      camera: { x: 900, y: 400, zoom: 0.5 }
    })
    expect(s.windows[0]).toMatchObject({ x: 1100, y: 600 })
    expect(s.camera).toEqual({ x: 900, y: 400, zoom: 0.5 })
  })

  it('starts a layout saved before the canvas at the old screen origin', () => {
    const s = wmReducer(initialState(desktop), {
      type: 'hydrate',
      windows: [],
      nextZ: 1,
      nextId: 1
    })
    expect(s.camera).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('routes an intent into the window and bumps the nonce even for an identical intent', () => {
    const intent = { type: 'open-student', studentId: 4 } as const
    let s = open(initialState(desktop), 'a', { intent })
    expect(s.windows[0]).toMatchObject({ intent, intentNonce: 1 })
    s = open(s, 'a', { intent })
    expect(s.windows[0].intentNonce).toBe(2)
  })
})

describe('the canvas camera', () => {
  it('opens a new window in the middle of what is on screen', () => {
    let s = initialState(desktop)
    s = wmReducer(s, { type: 'pan', dx: -3000, dy: -2000 })
    s = open(s, 'a')
    const win = s.windows[0]
    const view = viewport(s)
    expect(win.x).toBe(view.x + (view.w - win.w) / 2)
    expect(win.y).toBe(view.y + (view.h - win.h) / 2)
  })

  it('pans by a screen distance, which is more canvas when zoomed out', () => {
    let s = wmReducer(initialState(desktop), { type: 'pan', dx: -100, dy: 50 })
    expect(s.camera).toMatchObject({ x: 100, y: -50 })
    s = wmReducer(s, { type: 'zoom', zoom: 0.5, anchor: { x: 0, y: 0 } })
    s = wmReducer(s, { type: 'pan', dx: -100, dy: 0 })
    expect(s.camera.x).toBe(300)
  })

  it('zooms around the anchor, keeping the point under it still', () => {
    let s = open(initialState(desktop), 'a')
    const anchor = { x: 300, y: 200 }
    const before = { x: s.camera.x + anchor.x / s.camera.zoom, y: s.camera.y + anchor.y }
    s = wmReducer(s, { type: 'zoom', zoom: 1.5, anchor })
    expect(s.camera.x + anchor.x / s.camera.zoom).toBeCloseTo(before.x)
    expect(s.camera.y + anchor.y / s.camera.zoom).toBeCloseTo(before.y)
  })

  it('keeps the zoom within its limits', () => {
    let s = wmReducer(initialState(desktop), { type: 'zoom', zoom: 50 })
    expect(s.camera.zoom).toBe(MAX_ZOOM)
    s = wmReducer(s, { type: 'zoom', zoom: 0.001 })
    expect(s.camera.zoom).toBe(MIN_ZOOM)
    s = wmReducer(s, { type: 'zoom', zoom: Number.NaN })
    expect(s.camera.zoom).toBe(1)
  })

  it('draws a free window through the camera and a pinned one on the screen', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'move', id, x: 200, y: 100 })
    s = wmReducer(s, { type: 'setCamera', camera: { x: 100, y: 50, zoom: 0.5 } })
    expect(placement(s.windows[0], s)).toEqual({ x: 50, y: 25, w: 600, h: 400, scale: 0.5 })
    s = wmReducer(s, { type: 'toggleMaximize', id })
    expect(placement(s.windows[0], s)).toEqual({ x: 0, y: 0, ...desktop, scale: 1 })
  })

  it('frames every window, never zooming in past 100%', () => {
    let s = open(open(initialState(desktop), 'a'), 'b')
    const [a, b] = s.windows.map((w) => w.id)
    s = wmReducer(s, { type: 'move', id: a, x: -2000, y: 0 })
    s = wmReducer(s, { type: 'move', id: b, x: 2000, y: 1500 })
    s = wmReducer(s, { type: 'fitAll' })
    const view = viewport(s)
    for (const w of s.windows) {
      expect(w.x).toBeGreaterThanOrEqual(view.x)
      expect(w.y).toBeGreaterThanOrEqual(view.y)
      expect(w.x + w.w).toBeLessThanOrEqual(view.x + view.w)
      expect(w.y + w.h).toBeLessThanOrEqual(view.y + view.h)
    }
    expect(s.camera.zoom).toBeLessThan(1)

    let one = open(initialState(desktop), 'a')
    one = wmReducer(one, { type: 'fitAll' })
    expect(one.camera.zoom).toBe(1)
  })

  it('also frames the other things on the canvas it is told about', () => {
    let s = open(initialState(desktop), 'a')
    const pinned = { x: -3000, y: -2000, w: 200, h: 100 }
    s = wmReducer(s, { type: 'fitAll', extra: [pinned] })
    const view = viewport(s)
    expect(view.x).toBeLessThanOrEqual(pinned.x)
    expect(view.y).toBeLessThanOrEqual(pinned.y)
    expect(view.x + view.w).toBeGreaterThanOrEqual(s.windows[0].x + s.windows[0].w)
    // With no windows at all, the pinned things alone are framed.
    const only = wmReducer(initialState(desktop), { type: 'fitAll', extra: [pinned] })
    expect(viewport(only).x).toBeLessThanOrEqual(pinned.x)
  })

  it('brings an off-screen window into view when its app is opened again', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'move', id, x: 8000, y: 6000 })
    s = open(s, 'a')
    const view = viewport(s)
    const w = s.windows[0]
    expect(w.x).toBeGreaterThanOrEqual(view.x)
    expect(w.x + w.w).toBeLessThanOrEqual(view.x + view.w)
    expect(w.y).toBeGreaterThanOrEqual(view.y)
  })

  it('does not move the camera for a window already in view', () => {
    let s = open(initialState(desktop), 'a')
    const camera = s.camera
    s = open(s, 'a')
    expect(s.camera).toBe(camera)
  })

  it('un-snaps under the pointer while zoomed out', () => {
    let s = open(initialState(desktop), 'a')
    const id = s.windows[0].id
    s = wmReducer(s, { type: 'setCamera', camera: { x: 1000, y: 0, zoom: 0.5 } })
    s = wmReducer(s, { type: 'snap', id, side: 'left' })
    s = wmReducer(s, { type: 'unsnap', id, pointer: { x: 100, y: 16 } })
    // 100px on screen at 50% is 200 canvas units past the camera.
    expect(s.windows[0].x + s.windows[0].w / 2).toBe(1200)
  })
})
