import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useMasked } from './Sensitive'

export default function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
  sensitive = false,
  error = null
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
  /** Shows student data; its content is hidden while presenting. */
  sensitive?: boolean
  /** Shown inside the dialog so it is never hidden behind the backdrop. */
  error?: string | null
}): React.JSX.Element {
  const masked = useMasked()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portaled to <body>: an ancestor's backdrop-filter would otherwise capture position: fixed.
  return createPortal(
    <div className="modal-backdrop">
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-label={title}
        aria-modal="true"
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-quiet" onClick={onClose} aria-label="Close dialog">
            Close
          </button>
        </header>
        {sensitive && masked ? (
          <p className="hint">Hidden while presenting.</p>
        ) : (
          <>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <div className="modal-body">{children}</div>
            {footer && <footer className="modal-foot">{footer}</footer>}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
