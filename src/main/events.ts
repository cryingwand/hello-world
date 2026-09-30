import type { Role } from '@shared/access'
import { CHANGE_AUDIENCE, CHANGE_CHANNEL, type ChangeEvent } from '@shared/events'
import type { Emit } from './repos/types'

export interface Sendable {
  send(channel: string, payload: unknown): void
}

/**
 * Broadcasts a change, but only to the window roles that are meant to hear about it. Vault changes
 * never reach the launcher or the stage.
 */
export function createBroadcaster(windowsFor: (role: Role) => Sendable[]): Emit {
  return (name, detail) => {
    const event: ChangeEvent = { name, ...detail }
    for (const role of CHANGE_AUDIENCE[name]) {
      for (const w of windowsFor(role)) w.send(CHANGE_CHANNEL, event)
    }
  }
}
