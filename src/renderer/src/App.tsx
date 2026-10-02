import Desktop from './shell/Desktop'
import Dock from './shell/Dock'
import PresentationOffer from './shell/PresentationOffer'
import { ShellProvider, useShell } from './shell/ShellContext'
import TopBar from './shell/TopBar'
import StageApp from './stage/StageApp'
import { VaultFooter } from './vault/VaultChrome'
import { FOOTER_OPEN, FOOTER_STUDENT_DATA, studentDataOnScreen } from './vault/studentData'
import VaultRoot from './vault/VaultRoot'

function Shell(): React.JSX.Element {
  const { presenting, space, state, registry } = useShell()
  const students = space === 'vault' && studentDataOnScreen(state.windows, registry.byId)
  return (
    <div className={`shell shell-${space}${presenting ? ' presenting' : ''}`}>
      <TopBar />
      <PresentationOffer />
      <Desktop />
      <Dock />
      {space === 'vault' && (
        <VaultFooter>{students ? FOOTER_STUDENT_DATA : FOOTER_OPEN}</VaultFooter>
      )}
    </div>
  )
}

/** Draws the shell for this window's role, which the main process decided (not the page). */
export default function App(): React.JSX.Element {
  const role = window.api.role
  if (role === 'launcher') {
    return (
      <ShellProvider space="launcher">
        <Shell />
      </ShellProvider>
    )
  }
  if (role === 'vault') {
    // Nothing in the shell is mounted, so nothing calls the API, until the passcode is accepted.
    return (
      <VaultRoot>
        <ShellProvider space="vault">
          <Shell />
        </ShellProvider>
      </VaultRoot>
    )
  }
  if (role === 'stage') return <StageApp />
  return <p className="hint pad">This window has no role.</p>
}
