import Desktop from './shell/Desktop'
import Dock from './shell/Dock'
import PresentationOffer from './shell/PresentationOffer'
import { ShellProvider, useShell } from './shell/ShellContext'
import TopBar from './shell/TopBar'

function Shell(): React.JSX.Element {
  const { presenting } = useShell()
  return (
    <div className={`shell${presenting ? ' presenting' : ''}`}>
      <TopBar />
      <PresentationOffer />
      <Desktop />
      <Dock />
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <ShellProvider>
      <Shell />
    </ShellProvider>
  )
}
