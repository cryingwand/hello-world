import { useEffect, useRef, useState } from 'react'
import {
  formatClock,
  parseDuration,
  timerAdd,
  timerPause,
  timerRemaining,
  timerReset,
  timerSet,
  timerStart,
  timerTick,
  type TimerState
} from '@shared/tools'
import { timerOnStage, useStageLink } from './stageLink'

const PRESETS = [1, 2, 3, 5, 10, 15, 20, 30]

/** Three short beeps, made in the page so no sound file is needed. Quietly does nothing if audio is blocked. */
function beep(): void {
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < 3; i++) {
      const at = ctx.currentTime + i * 0.4
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.25, at)
      gain.gain.setValueAtTime(0.0001, at + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.3)
    }
    setTimeout(() => void ctx.close(), 1800)
  } catch {
    // No audio is not a reason to break the timer; the display still flashes.
  }
}

/** A countdown that works from the clock, so a busy or sleeping screen never makes it run slow. */
export default function TimerTool(): React.JSX.Element {
  const [state, setState] = useState<TimerState>(() => timerSet(5 * 60_000))
  const [now, setNow] = useState(() => Date.now())
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState(false)
  const [sound, setSound] = useState(true)
  const stage = useStageLink()

  // While the timer is on the Stage, every change goes there too; the Stage counts down by itself.
  useEffect(() => {
    if (stage.timer) timerOnStage(state).catch(() => undefined)
  }, [state, stage.timer])

  useEffect(() => {
    if (state.status !== 'running') return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      setState((s) => timerTick(s, t))
    }, 200)
    return () => clearInterval(id)
  }, [state.status])

  // Read at the moment it finishes: switching the checkbox afterwards must not make it beep again.
  const soundOn = useRef(sound)
  useEffect(() => {
    soundOn.current = sound
  }, [sound])
  useEffect(() => {
    if (state.status === 'done' && soundOn.current) beep()
  }, [state.status])

  const act = (change: (s: TimerState, t: number) => TimerState): void => {
    const t = Date.now()
    setNow(t)
    setState((s) => change(s, t))
  }
  const choose = (ms: number): void => {
    setCustomError(false)
    setState(timerSet(ms))
  }
  const applyCustom = (e: React.FormEvent): void => {
    e.preventDefault()
    const ms = parseDuration(custom)
    setCustomError(ms === null)
    if (ms !== null) {
      choose(ms)
      setCustom('')
    }
  }

  const left = timerRemaining(state, now)
  const total = Math.max(1, state.durationMs)
  const percent = state.status === 'done' ? 100 : Math.round(((total - left) / total) * 100)
  const running = state.status === 'running'

  return (
    <div className="tools-timer">
      <div
        className={`timer-face${state.status === 'done' ? ' timer-done' : ''}`}
        role="timer"
        aria-live="off"
        aria-label={`${formatClock(left)} left`}
      >
        {formatClock(left)}
      </div>
      <div className="timer-bar" aria-hidden="true">
        <div className="timer-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      {state.status === 'done' && (
        <p className="timer-over" role="status">
          Time is up
        </p>
      )}

      <div className="row tools-actions">
        {running ? (
          <button className="btn btn-primary tools-big" onClick={() => act(timerPause)}>
            Pause
          </button>
        ) : (
          <button
            className="btn btn-primary tools-big"
            disabled={state.durationMs <= 0 && state.remainingMs <= 0}
            onClick={() => act(timerStart)}
          >
            {state.status === 'paused'
              ? 'Resume'
              : state.status === 'done'
                ? 'Start again'
                : 'Start'}
          </button>
        )}
        <button
          className="btn"
          disabled={state.status === 'idle' && state.remainingMs === state.durationMs}
          onClick={() => setState(timerReset)}
        >
          Reset
        </button>
        <button className="btn" onClick={() => act((s, t) => timerAdd(s, 60_000, t))}>
          + 1 min
        </button>
        <button
          className="btn"
          disabled={state.status === 'done' || left <= 0}
          onClick={() => act((s, t) => timerAdd(s, -60_000, t))}
        >
          − 1 min
        </button>
        <span className="spacer" />
        <button
          className={`btn${stage.timer ? ' btn-primary' : ''}`}
          disabled={!stage.showing}
          title={stage.showing ? undefined : 'Start the Stage in the Presenter first'}
          onClick={() => timerOnStage(stage.timer ? null : state).catch(() => undefined)}
        >
          {stage.timer ? 'Take off the Stage' : 'Show on the Stage'}
        </button>
      </div>

      <div className="row tools-presets" role="group" aria-label="Set the timer">
        {PRESETS.map((m) => (
          <button
            key={m}
            className={`btn${state.durationMs === m * 60_000 && state.status === 'idle' ? ' btn-primary' : ''}`}
            onClick={() => choose(m * 60_000)}
          >
            {m} min
          </button>
        ))}
      </div>

      <form className="row tools-custom" onSubmit={applyCustom}>
        <label className="inline">
          Other
          <input
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value)
              setCustomError(false)
            }}
            placeholder="7, 1:30, 90s, 1h 15m"
            aria-invalid={customError}
            aria-label="Custom time"
          />
        </label>
        <button className="btn" type="submit" disabled={custom.trim() === ''}>
          Set
        </button>
        {customError && (
          <span className="hint warn" role="alert">
            Try 7 (minutes), 1:30, 90s or 1h 15m, up to 24 hours.
          </span>
        )}
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
          Beep at zero
        </label>
      </form>
    </div>
  )
}
