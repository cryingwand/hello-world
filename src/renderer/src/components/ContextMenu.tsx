import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/** A right-click menu at a screen point. Separators are `null`. Closes on a choice, Escape or a click away. */
export default function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: (MenuItem | null)[]
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    ref.current?.querySelector('button')?.focus()
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // Kept on screen: flipped left or up when it would run off the edge.
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 230),
    top: Math.min(y, window.innerHeight - 24 - items.length * 28)
  }
  // Portaled: inside a zoomed window or the canvas it would be scaled and clipped.
  return createPortal(
    <div ref={ref} className="context-menu" role="menu" style={style}>
      {items.map((item, i) =>
        item === null ? (
          <div key={i} className="context-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? 'context-danger' : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
