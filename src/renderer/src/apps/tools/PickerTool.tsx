import { useEffect, useRef, useState } from 'react'
import { newPicker, pickNext, type PickerState } from '@shared/tools'
import { showOnStage, useStageLink } from './stageLink'

const SPIN_MS = 700

/**
 * Picks someone at random. By default everyone goes once before anyone goes again, and a new round
 * never opens with the person who just went. Give it a new list and it starts over.
 */
export default function PickerTool({ names }: { names: string[] }): React.JSX.Element {
  const [state, setState] = useState<PickerState>(newPicker)
  const [repeats, setRepeats] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [toStage, setToStage] = useState(false)
  const stage = useStageLink()
  const sending = toStage && stage.showing
  const spin = useRef<{
    tick: ReturnType<typeof setInterval>
    stop: ReturnType<typeof setTimeout>
  } | null>(null)
  const clearSpin = (): void => {
    if (!spin.current) return
    clearInterval(spin.current.tick)
    clearTimeout(spin.current.stop)
    spin.current = null
  }

  // Leaving (or starting over with a new list) in the middle of a spin must not leave it running.
  useEffect(() => clearSpin, [])

  const pick = (): void => {
    if (names.length === 0 || spinning) return
    const next = pickNext(state, names.length, Math.random, repeats)
    // A short spin of other names first, so it feels drawn rather than printed.
    setSpinning(true)
    const tick = setInterval(() => setShown(names[Math.floor(Math.random() * names.length)]), 60)
    const stop = setTimeout(() => {
      clearInterval(tick)
      setState(next)
      setShown(names[next.last!])
      setSpinning(false)
      // Only the name that was drawn goes up, never the spin or the rest of the list.
      if (sending) showOnStage({ kind: 'picker', name: names[next.last!] }).catch(() => undefined)
    }, SPIN_MS)
    spin.current = { tick, stop }
  }

  const gone = new Set(state.picked)
  const total = names.length
  return (
    <div className="tools-picker">
      {total === 0 ? (
        <p className="hint">Add some names on the left to pick from.</p>
      ) : (
        <>
          <div
            className={`picker-name${spinning ? ' picker-spin' : ''}`}
            role="status"
            aria-live="polite"
          >
            {shown ?? '?'}
          </div>
          <div className="row tools-actions">
            <button className="btn btn-primary tools-big" onClick={pick} disabled={spinning}>
              {state.round === 0 ? 'Pick someone' : 'Pick another'}
            </button>
            <button
              className="btn"
              disabled={spinning || state.round === 0}
              onClick={() => {
                setState(newPicker())
                setShown(null)
              }}
            >
              Start over
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={repeats}
                onChange={(e) => setRepeats(e.target.checked)}
              />
              Allow the same person again
            </label>
            <label
              className="check"
              title={stage.showing ? undefined : 'Start the Stage in the Presenter first'}
            >
              <input
                type="checkbox"
                checked={sending}
                disabled={!stage.showing}
                onChange={(e) => {
                  setToStage(e.target.checked)
                  if (e.target.checked && shown && !spinning)
                    showOnStage({ kind: 'picker', name: shown }).catch(() => undefined)
                  if (!e.target.checked && stage.tool === 'picker')
                    showOnStage(null).catch(() => undefined)
                }}
              />
              Show each pick on the Stage
            </label>
          </div>
          {!repeats && (
            <>
              <p className="hint" role="status">
                Round {Math.max(1, state.round)}: {gone.size} of {total} have gone.
              </p>
              <ul className="chips" aria-label="Who has gone this round">
                {names.map((n, i) => (
                  <li key={i} className={gone.has(i) ? 'chip chip-done' : 'chip'}>
                    {n}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
