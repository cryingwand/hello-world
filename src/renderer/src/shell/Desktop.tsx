import { registry } from './appRegistry'
import { useShell } from './ShellContext'
import WindowFrame from './WindowFrame'

export default function Desktop(): React.JSX.Element {
  const { state, focused } = useShell()
  return (
    <main className="desktop">
      {state.windows.map((win) => {
        const app = registry.byId.get(win.appId)
        return app ? (
          <WindowFrame key={win.id} win={win} app={app} focused={win.id === focused} />
        ) : null
      })}
    </main>
  )
}
