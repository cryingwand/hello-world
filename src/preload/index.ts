import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type RendererApi } from '@shared/api'
import { CHANGE_CHANNEL, type ChangeEvent } from '@shared/events'

/** ipcRenderer prefixes remote errors; show the user only the message the main process wrote. */
const clean = (err: unknown): Error => {
  const msg = err instanceof Error ? err.message : String(err)
  return new Error(msg.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''))
}

function buildApi(): RendererApi {
  const api: Record<string, unknown> = {}
  for (const [ns, methods] of Object.entries(API_METHODS)) {
    const group: Record<string, unknown> = {}
    for (const method of methods) {
      group[method] = (...args: unknown[]) =>
        ipcRenderer.invoke(`${ns}.${method}`, ...args).catch((e: unknown) => {
          throw clean(e)
        })
    }
    api[ns] = group
  }
  api['platform'] = process.platform
  api['onChange'] = (listener: (event: ChangeEvent) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: ChangeEvent): void => listener(event)
    ipcRenderer.on(CHANGE_CHANNEL, handler)
    return () => ipcRenderer.removeListener(CHANGE_CHANNEL, handler)
  }
  return api as unknown as RendererApi
}

contextBridge.exposeInMainWorld('api', buildApi())
