import Desktop from './shell/Desktop'
import Dock from './shell/Dock'
import { ShellProvider } from './shell/ShellContext'
import TopBar from './shell/TopBar'

export default function App(): React.JSX.Element {
  return (
    <ShellProvider>
      <div className="shell">
        <TopBar />
        <Desktop />
        <Dock />
      </div>
    </ShellProvider>
  )
}
