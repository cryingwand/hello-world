import type { DisplayOffer } from '@shared/events'
import { DISPLAY_OFFER_CHANNEL } from '@shared/events'
import type { Notifier } from './notifier'

/** The slice of Electron's `screen` this needs, so it can be tested with a fake. */
export interface ScreenLike {
  getAllDisplays(): { internal?: boolean }[]
  on(
    event: 'display-added',
    listener: (e: unknown, display: { internal?: boolean }) => void
  ): unknown
  removeListener(
    event: 'display-added',
    listener: (e: unknown, display: { internal?: boolean }) => void
  ): unknown
}

export interface PresentationDeps {
  screen: ScreenLike
  notifier: Notifier
  /** Whether to offer presentation mode when a display appears (a setting). */
  offerEnabled: () => boolean
  send: (channel: string, payload: DisplayOffer) => void
  /** Called whenever the on/off state changes, for example to tick the View menu item. */
  onActiveChange?: (on: boolean) => void
}

/**
 * Main-process side of presentation mode. The window owns the on/off state and reports it here; this
 * holds notifications while it is on and tells the window when an external display connects.
 */
export function createPresentationService(deps: PresentationDeps) {
  let active = false

  const onAdded = (_e: unknown, display: { internal?: boolean }): void => {
    if (active || display.internal || !deps.offerEnabled()) return
    deps.send(DISPLAY_OFFER_CHANNEL, { reason: 'connected' })
  }
  deps.screen.on('display-added', onAdded)

  return {
    setActive(on: boolean): void {
      const changed = active !== on
      active = on
      deps.notifier.setPresenting(on)
      if (changed) deps.onActiveChange?.(on)
    },
    isActive: (): boolean => active,
    /** A second, non-built-in display is already plugged in (for example at launch). */
    externalDisplays(): number {
      const all = deps.screen.getAllDisplays()
      return all.length > 1 ? all.filter((d) => !d.internal).length : 0
    },
    offerEnabled: (): boolean => deps.offerEnabled(),
    dispose(): void {
      deps.screen.removeListener('display-added', onAdded)
    }
  }
}

export type PresentationService = ReturnType<typeof createPresentationService>
