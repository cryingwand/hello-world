import { ipcMain } from 'electron'
import { API_METHODS, type ApiContract } from '@shared/api'
import { ValidationError } from './validate'

/**
 * Registers one IPC handler per API method. Fails fast at startup if the implementation and the
 * shared method list have drifted, since the preload bridge is generated from that list.
 */
export function registerIpc(api: ApiContract): void {
  for (const ns of Object.keys(API_METHODS) as (keyof ApiContract)[]) {
    const declared = [...API_METHODS[ns]].sort()
    const actual = Object.keys(api[ns]).sort()
    if (declared.join() !== actual.join()) {
      throw new Error(`API namespace "${ns}" is out of sync with API_METHODS`)
    }
    for (const method of declared) {
      const fn = (api[ns] as unknown as Record<string, (...a: unknown[]) => unknown>)[
        method as string
      ]
      ipcMain.handle(`${ns}.${String(method)}`, async (_event, ...args: unknown[]) => {
        try {
          return await fn(...args)
        } catch (err) {
          // Validation messages are written for the user; anything else is logged and made generic.
          if (err instanceof ValidationError) throw err
          console.error(`[ipc] ${ns}.${String(method)} failed:`, err)
          throw new Error('Something went wrong saving that. Nothing was changed.', { cause: err })
        }
      })
    }
  }
}
