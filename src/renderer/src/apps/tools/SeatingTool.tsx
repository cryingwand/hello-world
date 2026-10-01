import { useState } from 'react'
import {
  MAX_SEAT_COLS,
  MAX_SEAT_ROWS,
  resizeSeats,
  seatRandomly,
  suggestGrid,
  swapSeats,
  type Seats
} from '@shared/tools'

interface Chart {
  rows: number
  cols: number
  seats: Seats
}

const clamp = (n: number, max: number): number => Math.min(max, Math.max(1, Math.floor(n) || 1))

function fresh(names: string[]): Chart {
  const { rows, cols } = suggestGrid(names.length)
  return { rows, cols, seats: seatRandomly(names, rows, cols, Math.random) }
}

/**
 * A seating chart: everyone in a random seat to start, then click one desk and another to swap them.
 * The grid can be resized without moving anyone who still has a desk. The chart starts over when the
 * names change.
 */
export default function SeatingTool({ names }: { names: string[] }): React.JSX.Element {
  const [chart, setChart] = useState<Chart>(() => fresh(names))
  const [selected, setSelected] = useState<number | null>(null)

  const resize = (rows: number, cols: number): void => {
    // The grid must always hold everyone, so a size that is too small is raised to fit.
    let r = clamp(rows, MAX_SEAT_ROWS)
    let c = clamp(cols, MAX_SEAT_COLS)
    if (r * c < names.length) {
      if (rows !== chart.rows) r = Math.min(MAX_SEAT_ROWS, Math.ceil(names.length / c))
      else c = Math.min(MAX_SEAT_COLS, Math.ceil(names.length / r))
    }
    if (r * c < names.length) return
    setChart({ rows: r, cols: c, seats: resizeSeats(chart.seats, chart.cols, r, c) })
    setSelected(null)
  }
  const reseat = (): void => {
    setChart({
      ...chart,
      seats: seatRandomly(names, chart.rows, chart.cols, Math.random)
    })
    setSelected(null)
  }
  const click = (i: number): void => {
    if (selected === null) {
      setSelected(i)
    } else {
      setChart({ ...chart, seats: swapSeats(chart.seats, selected, i) })
      setSelected(null)
    }
  }

  if (names.length === 0) {
    return <p className="hint">Add some names on the left to seat them.</p>
  }
  return (
    <div className="tools-seating">
      <div className="row tools-actions">
        <label className="inline">
          Rows
          <input
            className="narrow"
            type="number"
            min={1}
            max={MAX_SEAT_ROWS}
            value={chart.rows}
            onChange={(e) => resize(Number(e.target.value), chart.cols)}
          />
        </label>
        <label className="inline">
          Columns
          <input
            className="narrow"
            type="number"
            min={1}
            max={MAX_SEAT_COLS}
            value={chart.cols}
            onChange={(e) => resize(chart.rows, Number(e.target.value))}
          />
        </label>
        <button className="btn btn-primary" onClick={reseat}>
          Seat everyone again
        </button>
      </div>
      <p className="hint" role="status">
        {selected === null
          ? 'Click a desk, then another desk to swap them. Swapping with an empty desk moves the person.'
          : 'Now click the desk to swap with, or click the same desk to cancel.'}
      </p>
      <div className="seat-front">Front of the room</div>
      <div
        className="seat-grid"
        style={{ gridTemplateColumns: `repeat(${chart.cols}, minmax(72px, 1fr))` }}
        role="group"
        aria-label="Seating chart"
      >
        {chart.seats.map((name, i) => (
          <button
            key={i}
            className={`seat${name === null ? ' seat-empty' : ''}${selected === i ? ' seat-on' : ''}`}
            aria-pressed={selected === i}
            aria-label={`Row ${Math.floor(i / chart.cols) + 1}, seat ${(i % chart.cols) + 1}: ${name ?? 'empty'}`}
            onClick={() => (selected === i ? setSelected(null) : click(i))}
          >
            {name ?? ''}
          </button>
        ))}
      </div>
    </div>
  )
}
