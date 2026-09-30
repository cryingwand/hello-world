import { describe, expect, it } from 'vitest'
import { buildRegistry, sortForDock } from '@renderer/shell/registry'
import type { AppManifest } from '@apps/types'

const app = (id: string, handles: AppManifest['handles'] = []): AppManifest => ({
  id,
  name: id.toUpperCase(),
  icon: 'grid',
  component: () => null,
  defaultSize: { w: 100, h: 100 },
  handles,
  presentationSafe: true
})

describe('app registry', () => {
  it('indexes apps and resolves intents to their handler', () => {
    const r = buildRegistry([app('a', ['open-class']), app('b', ['open-student'])])
    expect(r.byId.get('a')?.id).toBe('a')
    expect(r.handlerFor('open-student')?.id).toBe('b')
    expect(r.handlerFor('attach-file')).toBeUndefined()
  })

  it('rejects duplicate ids', () => {
    expect(() => buildRegistry([app('a'), app('a')])).toThrow(/Duplicate app id/)
  })

  it('rejects two apps claiming the same intent', () => {
    expect(() => buildRegistry([app('a', ['open-class']), app('b', ['open-class'])])).toThrow(
      /handled by both/
    )
  })

  it('orders the dock with known apps first, then alphabetical', () => {
    const sorted = sortForDock([app('zed'), app('files'), app('alpha'), app('classes')])
    expect(sorted.map((a) => a.id)).toEqual(['classes', 'files', 'alpha', 'zed'])
  })
})
