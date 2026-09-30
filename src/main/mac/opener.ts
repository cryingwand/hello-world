import { NATIVE_APPS, type NativeApp, type OpenRequest, type OpenResult } from '@shared/files'
import type { Rect } from '@shared/geometry'
import type { Exec } from './exec'

/**
 * JXA run through `osascript -l JavaScript`. Arguments: process name, x, y, width, height.
 * System Events positions the process's first window; it answers 'ok', 'noprocess' or 'nowindow'
 * so the caller can keep polling while the app finishes launching.
 */
export const SNAP_SCRIPT = `function run(argv) {
  var name = argv[0];
  var x = Number(argv[1]), y = Number(argv[2]), w = Number(argv[3]), h = Number(argv[4]);
  var se = Application('System Events');
  var procs = se.processes.whose({ name: name });
  if (procs.length === 0) return 'noprocess';
  var p = procs[0];
  if (p.windows.length === 0) return 'nowindow';
  p.frontmost = true;
  var win = p.windows[0];
  win.position = [x, y];
  win.size = [w, h];
  return 'ok';
}`

const ACCESSIBILITY_HINT = /assistive|-1719|-25211|not allowed|not authorized|-1743/i

export interface LauncherSnap {
  /** Moves the launcher to the left half and returns the right half for the other app. Null if there is no window. */
  snapLeft(): Promise<Rect | null>
  restore(): void
}

export interface OpenDeps {
  exec: Exec
  isMac: () => boolean
  /** Accessibility permission; the real implementation also shows the system prompt the first time. */
  isTrusted: () => boolean
  launcher: LauncherSnap
  sleep: (ms: number) => Promise<void>
  now: () => number
  pollMs?: number
  timeoutMs?: number
}

const NEEDS_ACCESS =
  'To snap windows, allow Teaching OS under System Settings, Privacy & Security, Accessibility, then try again.'

export async function openInApp(req: OpenRequest, deps: OpenDeps): Promise<OpenResult> {
  if (!(NATIVE_APPS as readonly string[]).includes(req.app)) {
    return { opened: false, snapped: false, message: `${String(req.app)} is not a supported app.` }
  }
  const app: NativeApp = req.app
  if (!deps.isMac()) {
    return { opened: false, snapped: false, message: 'Opening in native apps only works on a Mac.' }
  }

  try {
    await deps.exec('open', app === 'default' ? [req.path] : ['-a', app, req.path])
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? ''
    const missing = /unable to find application/i.test(stderr)
    return {
      opened: false,
      snapped: false,
      message: missing
        ? `${app} is not installed on this Mac.`
        : `Could not open the file${app === 'default' ? '' : ` in ${app}`}.`
    }
  }

  if (!req.snap) return { opened: true, snapped: false }
  if (app === 'default') {
    return {
      opened: true,
      snapped: false,
      message: 'Pick a specific app to snap it beside the launcher.'
    }
  }
  if (!deps.isTrusted())
    return { opened: true, snapped: false, needsAccessibility: true, message: NEEDS_ACCESS }

  const target = await deps.launcher.snapLeft()
  if (!target)
    return {
      opened: true,
      snapped: false,
      message: 'The launcher window is not available to snap.'
    }

  const args = [
    '-l',
    'JavaScript',
    '-e',
    SNAP_SCRIPT,
    app,
    ...[target.x, target.y, target.width, target.height].map((n) => String(Math.round(n)))
  ]
  const pollMs = deps.pollMs ?? 350
  const deadline = deps.now() + (deps.timeoutMs ?? 8000)
  let lastProblem = `${app} did not open a window in time.`

  while (deps.now() < deadline) {
    try {
      const out = (await deps.exec('osascript', args, { timeoutMs: 10_000 })).stdout.trim()
      if (out === 'ok') return { opened: true, snapped: true }
      lastProblem = out === 'noprocess' ? `${app} is still starting.` : `${app} has no window yet.`
    } catch (err) {
      const text = `${(err as { stderr?: string }).stderr ?? ''} ${(err as Error).message ?? ''}`
      if (ACCESSIBILITY_HINT.test(text)) {
        deps.launcher.restore()
        return { opened: true, snapped: false, needsAccessibility: true, message: NEEDS_ACCESS }
      }
      lastProblem = 'Could not position the window.'
    }
    await deps.sleep(pollMs)
  }

  // Do not leave the launcher squeezed into half the screen with nothing beside it.
  deps.launcher.restore()
  return { opened: true, snapped: false, message: lastProblem }
}
