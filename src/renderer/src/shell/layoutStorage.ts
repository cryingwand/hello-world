import type { WindowState } from './windowManager'

const key = (space: string): string => `teachingos.layout.v1.${space}`

export interface SavedLayout {
  windows: WindowState[]
  nextZ: number
  nextId: number
}

/** Drop anything malformed or belonging to an app that no longer exists. */
export function sanitizeLayout(raw: unknown, knownAppIds: Set<string>): SavedLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<SavedLayout>
  if (!Array.isArray(r.windows)) return null
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const windows = r.windows.filter(
    (w): w is WindowState =>
      !!w &&
      typeof w.id === 'string' &&
      knownAppIds.has(w.appId) &&
      [w.x, w.y, w.w, w.h, w.z].every(num) &&
      !!w.minSize &&
      num(w.minSize.w) &&
      num(w.minSize.h)
  )
  const seen = new Set<string>()
  const unique = windows.filter((w) => (seen.has(w.appId) ? false : seen.add(w.appId)))
  const maxZ = unique.reduce((m, w) => Math.max(m, w.z), 0)
  const maxId = unique.reduce((m, w) => Math.max(m, Number(w.id.replace(/\D/g, '')) || 0), 0)
  return {
    // Intents are transient: never replay one on relaunch.
    windows: unique.map((w) => ({
      ...w,
      intent: undefined,
      intentNonce: undefined,
      maximized: !!w.maximized,
      snapped: w.snapped === 'left' || w.snapped === 'right' ? w.snapped : null,
      minimized: !!w.minimized
    })),
    nextZ: Math.max(num(r.nextZ) ? r.nextZ : 1, maxZ + 1),
    nextId: Math.max(num(r.nextId) ? r.nextId : 1, maxId + 1)
  }
}

export function loadLayout(knownAppIds: Set<string>, space: string): SavedLayout | null {
  try {
    const text = localStorage.getItem(key(space))
    return text ? sanitizeLayout(JSON.parse(text), knownAppIds) : null
  } catch {
    return null
  }
}

export function saveLayout(layout: SavedLayout, space: string): void {
  try {
    localStorage.setItem(key(space), JSON.stringify(layout))
  } catch {
    // Layout is a convenience; losing it must never break the shell.
  }
}
