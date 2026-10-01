/** Stand-in body for apps that are wired up in a later step. */
export default function AppPlaceholder({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="placeholder">
      <strong>{name}</strong>
      <span>Coming up in this build.</span>
    </div>
  )
}
