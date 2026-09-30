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
import type { DisplayOffer } from '@shared/events'
import type { Intent } from '@shared/intents'
import type { Space } from '@apps/types'
import { registryFor } from './appRegistry'
import type { Registry } from './registry'
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
  /** Which window this is: the launcher or the vault. */
  space: Space
  registry: Registry
  state: WmState
  focused: string | null
  dispatch: (action: WmAction) => void
  openApp: (appId: string) => void
  /** Route an intent to whichever app handles it. Returns false if none does. */
  dispatchIntent: (intent: Intent) => boolean
  presenting: boolean
  setPresenting: (on: boolean) => void
  /** Set when an external display is (or just became) connected and presentation mode is off. */
  displayOffer: DisplayOffer | null
  dismissDisplayOffer: () => void
  /** The class most apps default to; chosen in the top bar or by opening a class. */
  currentClassId: number | null
  setCurrentClassId: (id: number | null) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
}

const CLASS_KEY = 'teachingos.currentClass.v1'

function loadCurrentClass(): number | null {
  try {
    const n = Number(localStorage.getItem(CLASS_KEY))
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

const ShellContext = createContext<ShellApi | null>(null)

function desktopSize(): { w: number; h: number } {
  return { w: window.innerWidth, h: Math.max(window.innerHeight - TOPBAR_H - DOCK_H, 0) }
}

export function ShellProvider({
  space,
  children
}: {
  space: Space
  children: ReactNode
}): React.JSX.Element {
  const registry = registryFor(space)
  const [state, dispatch] = useReducer(wmReducer, undefined, () => {
    const base = initialState(desktopSize())
    const saved = loadLayout(new Set(registry.byId.keys()), space)
    return saved ? wmReducer(base, { type: 'hydrate', ...saved }) : base
  })
  const [presenting, setPresenting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [offer, setOffer] = useState<DisplayOffer | null>(null)
  // Once presentation mode is on, any pending offer is moot; clear it so it cannot resurface when it ends.
  if (presenting && offer) setOffer(null)
  const [currentClassId, setCurrentClassIdState] = useState<number | null>(loadCurrentClass)

  const setCurrentClassId = useCallback((id: number | null) => {
    setCurrentClassIdState(id)
    try {
      if (id === null) localStorage.removeItem(CLASS_KEY)
      else localStorage.setItem(CLASS_KEY, String(id))
    } catch {
      // A convenience only.
    }
  }, [])

  useEffect(() => {
    const onResize = (): void => dispatch({ type: 'setDesktop', desktop: desktopSize() })
    window.addEventListener('resize', onResize)
    // The window may have resized between the first render and this effect; sync once.
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The View menu item and its hotkey ask the window to flip presentation mode.
  useEffect(() => {
    if (space !== 'launcher') return
    return window.api.onPresentationToggle(() => setPresenting((on) => !on))
  }, [space])

  // Main needs to know the state to tick the menu item and to hold system notifications back.
  useEffect(() => {
    if (space !== 'launcher') return
    window.api.presentation.setActive(presenting).catch(() => undefined)
  }, [presenting, space])

  // Offer presentation mode when an external display connects, or is already connected at launch.
  useEffect(() => {
    if (space !== 'launcher') return
    const off = window.api.onDisplayOffer((o) => setOffer(o))
    window.api.presentation
      .state()
      .then((st) => {
        if (st.externalDisplays > 0 && st.offerEnabled) setOffer({ reason: 'already-connected' })
      })
      .catch(() => undefined)
    return off
  }, [space])

  // Persist the layout; debounced so dragging doesn't write on every pointer move.
  useEffect(() => {
    const t = setTimeout(
      () => saveLayout({ windows: state.windows, nextZ: state.nextZ, nextId: state.nextId }, space),
      250
    )
    return () => clearTimeout(t)
  }, [state.windows, state.nextZ, state.nextId, space])

  const openApp = useCallback(
    (appId: string) => {
      const app = registry.byId.get(appId)
      if (!app) return
      dispatch({ type: 'open', appId, size: app.defaultSize, minSize: app.minSize })
    },
    [registry]
  )

  const dispatchIntent = useCallback(
    (intent: Intent) => {
      const app = registry.handlerFor(intent.type)
      if (!app) return false
      dispatch({ type: 'open', appId: app.id, size: app.defaultSize, minSize: app.minSize, intent })
      return true
    },
    [registry]
  )

  const value = useMemo<ShellApi>(
    () => ({
      space,
      registry,
      state,
      focused: focusedId(state),
      dispatch,
      openApp,
      dispatchIntent,
      presenting,
      setPresenting,
      // An offer is moot once presentation mode is on.
      displayOffer: presenting ? null : offer,
      dismissDisplayOffer: () => setOffer(null),
      currentClassId,
      setCurrentClassId,
      settingsOpen,
      setSettingsOpen
    }),
    [
      space,
      registry,
      state,
      openApp,
      dispatchIntent,
      presenting,
      offer,
      currentClassId,
      setCurrentClassId,
      settingsOpen
    ]
  )
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used inside <ShellProvider>')
  return ctx
}
