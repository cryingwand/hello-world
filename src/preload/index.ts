import { contextBridge, ipcRenderer } from 'electron'
import { methodsFor, type Role } from '@shared/access'
import type { RendererApi } from '@shared/api'
import {
  CHANGE_CHANNEL,
  DISPLAY_OFFER_CHANNEL,
  PRESENTATION_TOGGLE_CHANNEL,
  type ChangeEvent,
  type DisplayOffer
} from '@shared/events'
import { VAULT_STATUS_CHANNEL, type VaultStatus } from '@shared/vault'

/** ipcRenderer prefixes remote errors; show the user only the message the main process wrote. */
const clean = (err: unknown): Error => {
  const msg = err instanceof Error ? err.message : String(err)
  return new Error(msg.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''))
}

// The main process decides this window's role from its own records; nothing here can change it.
const role = ipcRenderer.sendSync('tos:role') as Role | null

function buildApi(): RendererApi {
  const api: Record<string, unknown> = {}
  // Only the methods this role may call exist at all. Main enforces the same policy on every call.
  for (const [ns, methods] of Object.entries(role ? methodsFor(role) : {})) {
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
  api['role'] = role
  api['onChange'] = (listener: (event: ChangeEvent) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: ChangeEvent): void => listener(event)
    ipcRenderer.on(CHANGE_CHANNEL, handler)
    return () => ipcRenderer.removeListener(CHANGE_CHANNEL, handler)
  }
  api['onPresentationToggle'] = (listener: () => void): (() => void) => {
    const handler = (): void => listener()
    ipcRenderer.on(PRESENTATION_TOGGLE_CHANNEL, handler)
    return () => ipcRenderer.removeListener(PRESENTATION_TOGGLE_CHANNEL, handler)
  }
  api['onVaultStatus'] = (listener: (status: VaultStatus) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: VaultStatus): void => listener(status)
    ipcRenderer.on(VAULT_STATUS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(VAULT_STATUS_CHANNEL, handler)
  }
  api['onDisplayOffer'] = (listener: (offer: DisplayOffer) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, offer: DisplayOffer): void => listener(offer)
    ipcRenderer.on(DISPLAY_OFFER_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DISPLAY_OFFER_CHANNEL, handler)
  }
  return api as unknown as RendererApi
}

contextBridge.exposeInMainWorld('api', buildApi())
