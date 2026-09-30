import Desktop from './shell/Desktop'
import Dock from './shell/Dock'
import PresentationOffer from './shell/PresentationOffer'
import { ShellProvider, useShell } from './shell/ShellContext'
import TopBar from './shell/TopBar'

function Shell(): React.JSX.Element {
  const { presenting, space } = useShell()
  return (
    <div className={`shell shell-${space}${presenting ? ' presenting' : ''}`}>
      <TopBar />
      <PresentationOffer />
      <Desktop />
      <Dock />
    </div>
  )
}

/** Draws the shell for this window's role, which the main process decided (not the page). */
export default function App(): React.JSX.Element {
  const role = window.api.role
  if (role === 'launcher' || role === 'vault') {
    return (
      <ShellProvider space={role}>
        <Shell />
      </ShellProvider>
    )
  }
  return <p className="hint pad">This window has no role.</p>
}
