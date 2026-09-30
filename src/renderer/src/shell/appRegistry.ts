import type { AppManifest } from '@apps/types'
import { buildRegistry, sortForDock, type Registry } from './registry'

// Every apps/<id>/manifest.ts is picked up here; adding an app needs no other registration.
const modules = import.meta.glob<{ default: AppManifest }>('../apps/*/manifest.ts', { eager: true })

export const registry: Registry = buildRegistry(
  sortForDock(Object.values(modules).map((m) => m.default))
)
