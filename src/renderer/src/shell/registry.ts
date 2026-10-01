import type { IntentType } from '@shared/intents'
import type { AppManifest } from '@apps/types'

export interface Registry {
  apps: AppManifest[]
  byId: Map<string, AppManifest>
  /** The app that opens a given intent type, or undefined if nothing handles it. */
  handlerFor(type: IntentType): AppManifest | undefined
}

export function buildRegistry(manifests: AppManifest[]): Registry {
  const byId = new Map<string, AppManifest>()
  const handlers = new Map<IntentType, AppManifest>()
  for (const m of manifests) {
    if (byId.has(m.id)) throw new Error(`Duplicate app id "${m.id}"`)
    byId.set(m.id, m)
    for (const type of m.handles) {
      const owner = handlers.get(type)
      if (owner) throw new Error(`Intent "${type}" is handled by both "${owner.id}" and "${m.id}"`)
      handlers.set(type, m)
    }
  }
  return { apps: manifests, byId, handlerFor: (type) => handlers.get(type) }
}

/** Dock order; anything not listed follows alphabetically by name. */
const DOCK_ORDER = [
  'classes',
  'gradebook',
  'advising',
  'quizzes',
  'vault-files',
  'protected',
  'library'
]

export function sortForDock(manifests: AppManifest[]): AppManifest[] {
  const rank = (id: string): number => {
    const i = DOCK_ORDER.indexOf(id)
    return i === -1 ? DOCK_ORDER.length : i
  }
  return [...manifests].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
}
