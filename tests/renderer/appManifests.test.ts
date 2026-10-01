import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { IntentType } from '@shared/intents'
import type { Registry } from '@renderer/shell/registry'
import type { Space } from '@apps/types'

/**
 * The shell builds each window's registry when it starts, and `buildRegistry` throws if two apps in a
 * space claim one intent. Building the real registries here turns that startup crash into a test failure.
 */
const INTENTS: IntentType[] = [
  'open-student',
  'open-class',
  'open-advisee',
  'open-quiz',
  'open-gradebook',
  'attach-file',
  'record-score',
  'search-files',
  'open-path'
]

let registryFor: (space: Space) => Registry

beforeAll(async () => {
  // A few app modules read `window.api` when they load; the real one is the preload's.
  vi.stubGlobal('window', { api: { platform: 'darwin' } })
  registryFor = (await import('@renderer/shell/appRegistry')).registryFor
})

describe('app manifests', () => {
  it('build a registry for each space without two apps claiming one intent', () => {
    expect(() => registryFor('vault')).not.toThrow()
    expect(() => registryFor('launcher')).not.toThrow()
  })

  it('route every vault intent to exactly one vault app', () => {
    const vault = registryFor('vault')
    for (const type of [
      'open-student',
      'open-class',
      'open-advisee',
      'open-quiz',
      'open-gradebook'
    ] as const) {
      expect(vault.handlerFor(type), type).toBeDefined()
    }
    expect(vault.handlerFor('open-gradebook')?.id).toBe('gradebook')
    expect(vault.handlerFor('open-class')?.id).toBe('classes')
  })

  it('never route an intent about students or classes in the launcher', () => {
    const launcher = registryFor('launcher')
    for (const type of INTENTS) {
      if (type === 'search-files' || type === 'open-path') continue
      expect(launcher.handlerFor(type), type).toBeUndefined()
    }
    // Files on the Mac (never records) are opened in the everyday Files app.
    expect(launcher.handlerFor('open-path')?.id).toBe('library')
  })
})
