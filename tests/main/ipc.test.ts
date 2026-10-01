import { describe, expect, it, vi } from 'vitest'
import type { ApiContract } from '@shared/api'
import type { Role } from '@shared/access'
import {
  AccessDeniedError,
  registerIpc,
  type IpcEventLike,
  type IpcMainLike
} from '../../src/main/ipc'
import { createBroadcaster } from '../../src/main/events'
import { createRoleRegistry } from '../../src/main/roles'
import { ValidationError } from '../../src/main/validate'
import { API_METHODS } from '@shared/api'

type Handler = (event: IpcEventLike, ...args: unknown[]) => unknown

/** An API object where every method records who implemented it. */
function fakeApi(
  label: string,
  overrides: Record<string, Record<string, (...a: unknown[]) => unknown>> = {}
): ApiContract {
  const api: Record<string, Record<string, unknown>> = {}
  for (const ns of Object.keys(API_METHODS) as (keyof typeof API_METHODS)[]) {
    api[ns] = {}
    for (const m of API_METHODS[ns] as readonly string[]) {
      api[ns][m] = overrides[ns]?.[m] ?? (() => `${label}:${ns}.${m}`)
    }
  }
  return api as unknown as ApiContract
}

function setup(
  opts: {
    beforeCall?: Parameters<typeof registerIpc>[0]['beforeCall']
    overrides?: Parameters<typeof fakeApi>[1]
  } = {}
) {
  const handlers = new Map<string, Handler>()
  const listeners = new Map<string, (e: IpcEventLike & { returnValue?: unknown }) => void>()
  const ipc: IpcMainLike = {
    handle: (channel, fn) => void handlers.set(channel, fn),
    on: (channel, fn) => void listeners.set(channel, fn)
  }
  const registry = createRoleRegistry<object>()
  const mainFrame = { name: 'main' }
  const sender = (id: number) => ({ id, mainFrame })
  registry.add('launcher', 1, {})
  registry.add('vault', 2, {})
  registry.add('stage', 3, {})
  registerIpc({
    ipc,
    roleOf: (s) => registry.roleOf(s),
    apis: {
      launcher: fakeApi('launcher', opts.overrides),
      vault: fakeApi('vault', opts.overrides),
      stage: fakeApi('stage', opts.overrides)
    },
    beforeCall: opts.beforeCall
  })
  const call = (
    id: number,
    channel: string,
    args: unknown[] = [],
    frame: unknown = mainFrame
  ): Promise<unknown> =>
    Promise.resolve(handlers.get(channel)!({ sender: sender(id), senderFrame: frame }, ...args))
  /** A call whose event has no frame at all (the default parameter above would fill one in). */
  const callWithoutFrame = (id: number, channel: string): Promise<unknown> =>
    Promise.resolve(handlers.get(channel)!({ sender: sender(id) }))
  return { call, callWithoutFrame, handlers, listeners, sender, mainFrame }
}

describe('registerIpc', () => {
  it('registers a handler for every API method', () => {
    const { handlers } = setup()
    const total = Object.values(API_METHODS).reduce((n, m) => n + m.length, 0)
    expect(handlers.size).toBe(total)
  })

  it("runs the implementation that belongs to the caller's role", async () => {
    const { call } = setup()
    expect(await call(1, 'files.search')).toBe('launcher:files.search')
    expect(await call(2, 'files.search')).toBe('vault:files.search')
  })

  it('refuses the launcher every vault method, and the stage everything', async () => {
    const { call } = setup()
    await expect(call(1, 'students.list')).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(call(1, 'grading.scores', [1])).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(call(3, 'files.search')).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(call(3, 'students.list')).rejects.toBeInstanceOf(AccessDeniedError)
    expect(await call(2, 'students.list')).toBe('vault:students.list')
  })

  it('refuses every method listed for the vault when called from the launcher (exhaustive)', async () => {
    const { call } = setup()
    const { API_ACCESS } = await import('@shared/access')
    for (const ns of Object.keys(API_ACCESS) as (keyof typeof API_ACCESS)[]) {
      for (const [method, access] of Object.entries(API_ACCESS[ns])) {
        const allowed = (access as { roles: readonly Role[] }).roles.includes('launcher')
        const result = call(1, `${ns}.${method}`)
        if (allowed) await expect(result).resolves.toBeDefined()
        else await expect(result).rejects.toBeInstanceOf(AccessDeniedError)
      }
    }
  })

  it('refuses unknown windows', async () => {
    const { call } = setup()
    await expect(call(99, 'files.search')).rejects.toBeInstanceOf(AccessDeniedError)
  })

  it('lets the stage ask what to show and nothing else', async () => {
    const { call } = setup()
    expect(await call(3, 'stage.view')).toBe('stage:stage.view')
    const { API_ACCESS } = await import('@shared/access')
    for (const ns of Object.keys(API_ACCESS) as (keyof typeof API_ACCESS)[]) {
      for (const method of Object.keys(API_ACCESS[ns])) {
        if (ns === 'stage' && method === 'view') continue
        await expect(call(3, `${ns}.${method}`), `${ns}.${method}`).rejects.toBeInstanceOf(
          AccessDeniedError
        )
      }
    }
  })

  it('refuses the stage controls to the stage and the vault, and the stage view to the launcher', async () => {
    const { call } = setup()
    await expect(call(3, 'stage.end')).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(call(2, 'stage.start')).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(call(1, 'stage.view')).rejects.toBeInstanceOf(AccessDeniedError)
    expect(await call(1, 'stage.start')).toBe('launcher:stage.start')
  })

  it('refuses calls from a sub-frame, such as an iframe preview, and from a missing frame', async () => {
    const { call, callWithoutFrame } = setup()
    await expect(call(2, 'students.list', [], { name: 'iframe' })).rejects.toBeInstanceOf(
      AccessDeniedError
    )
    await expect(callWithoutFrame(2, 'students.list')).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(call(2, 'students.list', [], null)).rejects.toBeInstanceOf(AccessDeniedError)
  })

  it('passes arguments through and lets user-facing errors through unchanged', async () => {
    const { call } = setup({
      overrides: {
        students: {
          get: (id) => `got ${String(id)}`,
          create: () => {
            throw new ValidationError('A student needs a name')
          }
        }
      }
    })
    expect(await call(2, 'students.get', [7])).toBe('got 7')
    await expect(call(2, 'students.create', [{}])).rejects.toThrow('A student needs a name')
  })

  it('hides unexpected error details behind a generic message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { call } = setup({
      overrides: {
        students: {
          list: () => {
            throw new Error('SQLITE_CORRUPT: secret path /Users/t/x')
          }
        }
      }
    })
    const err = await call(2, 'students.list').catch((e: Error) => e)
    expect((err as Error).message).toBe('Something went wrong saving that. Nothing was changed.')
    expect((err as Error).message).not.toMatch(/SQLITE|secret/)
    spy.mockRestore()
  })

  it('runs the state check before the method, and its refusal reaches the caller', async () => {
    const calls: string[] = []
    const { call } = setup({
      beforeCall: (role, ns, method, access) => {
        calls.push(`${role}:${ns}.${method}:${access.needsVault ? 'vault' : 'open'}`)
        if (access.needsVault) throw new AccessDeniedError()
      }
    })
    await expect(call(2, 'students.list')).rejects.toBeInstanceOf(AccessDeniedError)
    expect(await call(2, 'files.search')).toBe('vault:files.search')
    expect(calls).toEqual(['vault:students.list:vault', 'vault:files.search:open'])
  })

  it('waits for an async state check, and never runs the method if it rejects', async () => {
    let finish: () => void = () => undefined
    const { call } = setup({
      beforeCall: (_role, _ns, method) =>
        method === 'delete'
          ? Promise.reject(new ValidationError('No backup, no delete.'))
          : new Promise<void>((resolve) => (finish = resolve))
    })
    await expect(call(2, 'students.delete', [1])).rejects.toThrow('No backup, no delete.')
    let done = false
    const pending = call(2, 'students.list').then((r) => {
      done = true
      return r
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(done).toBe(false)
    finish()
    expect(await pending).toBe('vault:students.list')
  })

  it('does not run the state check for a caller the policy already refused', async () => {
    const before = vi.fn()
    const { call } = setup({ beforeCall: before })
    await expect(call(1, 'students.list')).rejects.toBeInstanceOf(AccessDeniedError)
    expect(before).not.toHaveBeenCalled()
  })

  it('answers the role query from the registry, and null for an unknown window', () => {
    const { listeners, sender } = setup()
    const ask = (id: number) => {
      const e: IpcEventLike & { returnValue?: unknown } = { sender: sender(id) }
      listeners.get('tos:role')!(e)
      return e.returnValue
    }
    expect(ask(1)).toBe('launcher')
    expect(ask(2)).toBe('vault')
    expect(ask(99)).toBeNull()
  })

  it('fails at startup if an implementation has drifted from the method list', () => {
    const broken = fakeApi('x')
    delete (broken.students as unknown as Record<string, unknown>)['delete']
    expect(() =>
      registerIpc({
        ipc: { handle: () => undefined, on: () => undefined },
        roleOf: () => undefined,
        apis: { launcher: broken }
      })
    ).toThrow(/out of sync/)
  })
})

describe('role registry', () => {
  it('finds roles by window and forgets closed windows', () => {
    const r = createRoleRegistry<string>()
    r.add('vault', 10, 'v')
    r.add('launcher', 11, 'l')
    expect(r.roleOf({ id: 10 })).toBe('vault')
    expect(r.windows('vault')).toEqual(['v'])
    expect(r.first('launcher')).toBe('l')
    expect(r.count()).toBe(2)
    r.remove(10)
    expect(r.roleOf({ id: 10 })).toBeUndefined()
    expect(r.first('vault')).toBeUndefined()
  })
})

describe('change broadcast', () => {
  it('sends vault changes only to vault windows and settings changes to launcher and vault', () => {
    const sent: string[] = []
    const make = (role: string) => ({
      send: (_c: string, p: unknown) => void sent.push(`${role}<-${(p as { name: string }).name}`)
    })
    const emit = createBroadcaster((role) => (role === 'stage' ? [make('stage')] : [make(role)]))
    emit('scores.changed', { classId: 3 })
    emit('settings.changed')
    expect(sent.sort()).toEqual([
      'launcher<-settings.changed',
      'vault<-scores.changed',
      'vault<-settings.changed'
    ])
  })
})
