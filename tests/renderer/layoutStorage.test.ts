import { describe, expect, it } from 'vitest'
import { sanitizeLayout } from '@renderer/shell/layoutStorage'

const win = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'win-3',
  appId: 'a',
  x: 10,
  y: 10,
  w: 500,
  h: 400,
  z: 7,
  minimized: false,
  maximized: false,
  snapped: null,
  minSize: { w: 300, h: 200 },
  ...over
})

describe('sanitizeLayout', () => {
  const known = new Set(['a', 'b'])

  it('rejects garbage', () => {
    expect(sanitizeLayout(null, known)).toBeNull()
    expect(sanitizeLayout('nope', known)).toBeNull()
    expect(sanitizeLayout({ windows: 'x' }, known)).toBeNull()
  })

  it('keeps valid windows and derives counters above existing ids and z', () => {
    const out = sanitizeLayout({ windows: [win()], nextZ: 1, nextId: 1 }, known)!
    expect(out.windows).toHaveLength(1)
    expect(out.nextZ).toBe(8)
    expect(out.nextId).toBe(4)
  })

  it('drops windows for unknown apps, malformed geometry and duplicate apps', () => {
    const out = sanitizeLayout(
      {
        windows: [
          win({ appId: 'gone' }),
          win({ id: 'win-4', x: 'left' }),
          win({ id: 'win-5', appId: 'b' }),
          win({ id: 'win-6', appId: 'b' })
        ]
      },
      known
    )!
    expect(out.windows.map((w) => w.id)).toEqual(['win-5'])
  })

  it('never replays a stored intent', () => {
    const out = sanitizeLayout(
      { windows: [win({ intent: { type: 'open-class', classId: 1 }, intentNonce: 3 })] },
      known
    )!
    expect(out.windows[0].intent).toBeUndefined()
    expect(out.windows[0].intentNonce).toBeUndefined()
  })

  it('normalises an invalid snap value', () => {
    const out = sanitizeLayout({ windows: [win({ snapped: 'top' })] }, known)!
    expect(out.windows[0].snapped).toBeNull()
  })
})
