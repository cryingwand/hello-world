export default function ErrorBanner({
  message,
  onDismiss
}: {
  message: string | null
  onDismiss: () => void
}): React.JSX.Element | null {
  if (!message) return null
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button className="btn btn-quiet" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
