import { describe, expect, it } from 'vitest'
import type { Rect } from '@shared/geometry'
import type { Exec } from '../../src/main/mac/exec'
import { SNAP_SCRIPT, openInApp, type OpenDeps } from '../../src/main/mac/opener'

interface Call {
  cmd: string
  args: string[]
}

function harness(
  opts: {
    osascript?: (n: number) => string | Error
    open?: Error
    trusted?: boolean
    mac?: boolean
    target?: Rect | null
  } = {}
) {
  const calls: Call[] = []
  const events: string[] = []
  let clock = 0
  let osaCalls = 0
  const exec: Exec = async (cmd, args) => {
    calls.push({ cmd, args })
    if (cmd === 'open') {
      events.push('open')
      if (opts.open) throw opts.open
      return { stdout: '', stderr: '' }
    }
    events.push('osascript')
    const r = (opts.osascript ?? (() => 'ok'))(osaCalls++)
    if (r instanceof Error) throw r
    return { stdout: `${r}\n`, stderr: '' }
  }
  const deps: OpenDeps = {
    exec,
    isMac: () => opts.mac ?? true,
    isTrusted: () => opts.trusted ?? true,
    launcher: {
      snapLeft: async () => {
        events.push('snapLeft')
        return opts.target === undefined ? { x: 720, y: 25, width: 720, height: 800 } : opts.target
      },
      restore: () => events.push('restore')
    },
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    pollMs: 100,
    timeoutMs: 1000
  }
  return { deps, calls, events }
}

const req = { path: '/Users/tyler/Docs/Unit 3.docx', app: 'Microsoft Word' as const, snap: true }

describe('openInApp', () => {
  it('opens with `open -a`, snaps the launcher left, then positions the app on the right half', async () => {
    const h = harness()
    const res = await openInApp(req, h.deps)
    expect(res).toEqual({ opened: true, snapped: true })
    expect(h.calls[0]).toEqual({
      cmd: 'open',
      args: ['-a', 'Microsoft Word', '/Users/tyler/Docs/Unit 3.docx']
    })
    expect(h.calls[1]).toEqual({
      cmd: 'osascript',
      args: ['-l', 'JavaScript', '-e', SNAP_SCRIPT, 'Microsoft Word', '720', '25', '720', '800']
    })
    expect(h.events).toEqual(['open', 'snapLeft', 'osascript'])
  })

  it('rounds fractional coordinates', async () => {
    const h = harness({ target: { x: 720.5, y: 24.6, width: 719.5, height: 800.4 } })
    await openInApp(req, h.deps)
    expect(h.calls[1].args.slice(-4)).toEqual(['721', '25', '720', '800'])
  })

  it('passes a path with quotes and spaces as a single argument (no shell)', async () => {
    const h = harness()
    const evil = '/Users/tyler/Docs/a "b" $(x); rm.docx'
    await openInApp({ ...req, path: evil }, h.deps)
    expect(h.calls[0].args).toEqual(['-a', 'Microsoft Word', evil])
  })

  it('opens without snapping when not asked', async () => {
    const h = harness()
    expect(await openInApp({ ...req, snap: false }, h.deps)).toEqual({
      opened: true,
      snapped: false
    })
    expect(h.events).toEqual(['open'])
  })

  it('uses the default app without snapping, and says why', async () => {
    const h = harness()
    const res = await openInApp({ ...req, app: 'default' }, h.deps)
    expect(h.calls[0]).toEqual({ cmd: 'open', args: [req.path] })
    expect(res).toMatchObject({ opened: true, snapped: false })
    expect(res.message).toMatch(/specific app/)
    expect(h.events).toEqual(['open'])
  })

  it('polls until the app has a window', async () => {
    const h = harness({ osascript: (n) => (n < 3 ? (n === 0 ? 'noprocess' : 'nowindow') : 'ok') })
    expect(await openInApp(req, h.deps)).toEqual({ opened: true, snapped: true })
    expect(h.calls.filter((c) => c.cmd === 'osascript')).toHaveLength(4)
  })

  it('gives up after the timeout, restores the launcher, and explains', async () => {
    const h = harness({ osascript: () => 'nowindow' })
    const res = await openInApp(req, h.deps)
    expect(res).toMatchObject({ opened: true, snapped: false })
    expect(res.message).toMatch(/no window yet/)
    expect(h.events.at(-1)).toBe('restore')
  })

  it('asks for the Accessibility permission up front, opening the file but leaving the layout alone', async () => {
    const h = harness({ trusted: false })
    const res = await openInApp(req, h.deps)
    expect(res).toMatchObject({ opened: true, snapped: false, needsAccessibility: true })
    expect(h.events).toEqual(['open'])
  })

  it('detects an Accessibility refusal from osascript and puts the launcher back', async () => {
    const denied = Object.assign(new Error('failed'), {
      stderr:
        'execution error: System Events got an error: osascript is not allowed assistive access. (-25211)'
    })
    const h = harness({ osascript: () => denied })
    const res = await openInApp(req, h.deps)
    expect(res).toMatchObject({ opened: true, snapped: false, needsAccessibility: true })
    expect(h.events.at(-1)).toBe('restore')
    expect(h.calls.filter((c) => c.cmd === 'osascript')).toHaveLength(1)
  })

  it('reports an app that is not installed', async () => {
    const h = harness({
      open: Object.assign(new Error('x'), {
        stderr: 'Unable to find application named "Microsoft Excel"'
      })
    })
    const res = await openInApp({ ...req, app: 'Microsoft Excel' }, h.deps)
    expect(res).toEqual({
      opened: false,
      snapped: false,
      message: 'Microsoft Excel is not installed on this Mac.'
    })
    expect(h.events).toEqual(['open'])
  })

  it('reports a generic open failure', async () => {
    const h = harness({ open: new Error('boom') })
    expect((await openInApp(req, h.deps)).message).toMatch(
      /Could not open the file in Microsoft Word/
    )
  })

  it('rejects apps outside the allowlist without running anything', async () => {
    const h = harness()
    const res = await openInApp({ ...req, app: 'Terminal' as never }, h.deps)
    expect(res.opened).toBe(false)
    expect(h.calls).toHaveLength(0)
  })

  it('refuses politely when not on a Mac', async () => {
    const h = harness({ mac: false })
    const res = await openInApp(req, h.deps)
    expect(res).toMatchObject({ opened: false, snapped: false })
    expect(h.calls).toHaveLength(0)
  })

  it('does not snap if the launcher window is unavailable', async () => {
    const h = harness({ target: null })
    const res = await openInApp(req, h.deps)
    expect(res).toMatchObject({ opened: true, snapped: false })
    expect(h.calls.filter((c) => c.cmd === 'osascript')).toHaveLength(0)
  })
})

describe('SNAP_SCRIPT', () => {
  it('is a JXA run handler that positions and sizes the first window', () => {
    expect(SNAP_SCRIPT).toContain('function run(argv)')
    expect(SNAP_SCRIPT).toContain("Application('System Events')")
    expect(SNAP_SCRIPT).toContain('win.position = [x, y]')
    expect(SNAP_SCRIPT).toContain('win.size = [w, h]')
    // Compiles as JavaScript (it is JXA, which is JS), so a typo here fails a test instead of at 9am.
    expect(() => new Function('Application', `${SNAP_SCRIPT}; return run`)).not.toThrow()
  })

  it('behaves correctly against a fake System Events', () => {
    const win: { position?: number[]; size?: number[] } = {}
    const proc = { windows: { length: 1, 0: win }, frontmost: false }
    const make = (procs: unknown[]) => () => ({ processes: { whose: () => procs } })
    const run = (procs: unknown[], argv: string[]) =>
      (
        new Function('Application', `${SNAP_SCRIPT}; return run`)(make(procs)) as (
          a: string[]
        ) => string
      )(argv)
    expect(run([proc], ['Preview', '10', '20', '300', '400'])).toBe('ok')
    expect(win).toEqual({ position: [10, 20], size: [300, 400] })
    expect(proc.frontmost).toBe(true)
    expect(run([], ['Preview', '0', '0', '1', '1'])).toBe('noprocess')
    expect(run([{ windows: { length: 0 } }], ['Preview', '0', '0', '1', '1'])).toBe('nowindow')
  })
})
