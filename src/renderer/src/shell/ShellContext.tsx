import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode
} from 'react'
import type { Intent } from '@shared/intents'
import { registry } from './appRegistry'
import { loadLayout, saveLayout } from './layoutStorage'
import {
  DOCK_H,
  TOPBAR_H,
  focusedId,
  initialState,
  wmReducer,
  type WmAction,
  type WmState
} from './windowManager'

interface ShellApi {
  state: WmState
  focused: string | null
  dispatch: (action: WmAction) => void
  openApp: (appId: string) => void
  /** Route an intent to whichever app handles it. Returns false if none does. */
  dispatchIntent: (intent: Intent) => boolean
  presenting: boolean
  setPresenting: (on: boolean) => void
}

const ShellContext = createContext<ShellApi | null>(null)

function desktopSize(): { w: number; h: number } {
  return { w: window.innerWidth, h: Math.max(window.innerHeight - TOPBAR_H - DOCK_H, 0) }
}

export function ShellProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(wmReducer, undefined, () => {
    const base = initialState(desktopSize())
    const saved = loadLayout(new Set(registry.byId.keys()))
    return saved ? wmReducer(base, { type: 'hydrate', ...saved }) : base
  })
  const [presenting, setPresenting] = useState(false)

  useEffect(() => {
    const onResize = (): void => dispatch({ type: 'setDesktop', desktop: desktopSize() })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Persist the layout; debounced so dragging doesn't write on every pointer move.
  useEffect(() => {
    const t = setTimeout(
      () => saveLayout({ windows: state.windows, nextZ: state.nextZ, nextId: state.nextId }),
      250
    )
    return () => clearTimeout(t)
  }, [state.windows, state.nextZ, state.nextId])

  const openApp = useCallback((appId: string) => {
    const app = registry.byId.get(appId)
    if (!app) return
    dispatch({ type: 'open', appId, size: app.defaultSize, minSize: app.minSize })
  }, [])

  const dispatchIntent = useCallback((intent: Intent) => {
    const app = registry.handlerFor(intent.type)
    if (!app) return false
    dispatch({ type: 'open', appId: app.id, size: app.defaultSize, minSize: app.minSize, intent })
    return true
  }, [])

  const value = useMemo<ShellApi>(
    () => ({
      state,
      focused: focusedId(state),
      dispatch,
      openApp,
      dispatchIntent,
      presenting,
      setPresenting
    }),
    [state, openApp, dispatchIntent, presenting]
  )
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used inside <ShellProvider>')
  return ctx
}
