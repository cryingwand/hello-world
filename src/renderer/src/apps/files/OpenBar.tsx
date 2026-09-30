import { useState } from 'react'
import { NATIVE_APPS, preferredApp, type NativeApp, type OpenResult } from '@shared/files'

const SNAP_KEY = 'teachingos.files.snap.v1'
const loadSnap = (): boolean => {
  try {
    return localStorage.getItem(SNAP_KEY) !== '0'
  } catch {
    return true
  }
}

export default function OpenBar({
  path,
  onAttach
}: {
  path: string
  /** Only offered in the vault, where attaching to a class or student is possible. */
  onAttach?: () => void
}): React.JSX.Element {
  const [app, setApp] = useState<NativeApp>(() => preferredApp(path))
  const [chosenFor, setChosenFor] = useState(path)
  const [snap, setSnap] = useState(loadSnap)
  const [result, setResult] = useState<OpenResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A newly selected file goes back to its natural app.
  if (chosenFor !== path) {
    setChosenFor(path)
    setApp(preferredApp(path))
    setResult(null)
    setError(null)
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await window.api.files.open({ path, app, snap }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const toggleSnap = (on: boolean): void => {
    setSnap(on)
    try {
      localStorage.setItem(SNAP_KEY, on ? '1' : '0')
    } catch {
      // A convenience only.
    }
  }
  const guard = (p: Promise<unknown>): void =>
    void p.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))

  return (
    <div className="open-bar">
      <div className="row">
        <button className="btn btn-primary" onClick={run} disabled={busy}>
          {busy
            ? 'Opening…'
            : `Open in ${app === 'default' ? 'default app' : app.replace('Microsoft ', '')}`}
        </button>
        <select
          value={app}
          onChange={(e) => setApp(e.target.value as NativeApp)}
          aria-label="Open with"
        >
          {NATIVE_APPS.map((a) => (
            <option key={a} value={a}>
              {a === 'default' ? 'Default app' : a}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => toggleSnap(e.target.checked)} />
          Snap beside launcher
        </label>
        <span className="spacer" />
        <button className="btn" onClick={() => guard(window.api.files.reveal(path))}>
          Show in Finder
        </button>
        {onAttach && (
          <button className="btn" onClick={onAttach}>
            Attach to…
          </button>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {result && (result.message || result.snapped) && (
        <div className={result.opened ? 'notice-bar' : 'error-banner'} role="status">
          <span>{result.snapped ? 'Opened and snapped beside the launcher.' : result.message}</span>
          <span className="row">
            {result.needsAccessibility && (
              <button
                className="btn"
                onClick={() => guard(window.api.system.openAccessibilitySettings())}
              >
                Open Accessibility settings
              </button>
            )}
            {result.snapped && (
              <button className="btn" onClick={() => guard(window.api.files.restoreLayout())}>
                Restore full screen
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
