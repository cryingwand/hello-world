import { useShell } from '@renderer/shell/ShellContext'

/** True while presentation mode is on and student names and grades must not be shown. */
export function useMasked(): boolean {
  return useShell().presenting
}

/** Renders its children normally, or a blank placeholder while presenting. Wrap every student name, email, note or grade. */
export default function Sensitive({
  children,
  placeholder = '••••••'
}: {
  children: React.ReactNode
  placeholder?: string
}): React.JSX.Element {
  const masked = useMasked()
  return masked ? (
    <span className="masked" aria-label="hidden while presenting">
      {placeholder}
    </span>
  ) : (
    <>{children}</>
  )
}
