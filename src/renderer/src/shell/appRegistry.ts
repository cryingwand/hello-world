import type { AppManifest, Space } from '@apps/types'
import { buildRegistry, sortForDock, type Registry } from './registry'

// Every apps/<id>/manifest.ts is picked up here; adding an app needs no other registration.
const modules = import.meta.glob<{ default: AppManifest }>('../apps/*/manifest.ts', { eager: true })
const all = Object.values(modules).map((m) => m.default)

const cache = new Map<Space, Registry>()

/** The apps one window role can show. Intents are routed within a space, never across. */
export function registryFor(space: Space): Registry {
  let r = cache.get(space)
  if (!r) {
    r = buildRegistry(sortForDock(all.filter((m) => m.space === space)))
    cache.set(space, r)
  }
  return r
}
