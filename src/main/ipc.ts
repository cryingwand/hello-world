import { API_METHODS, type ApiContract } from '@shared/api'
import { accessFor, type Access, type Role } from '@shared/access'
import { ValidationError } from './validate'

/** Raised when a window calls something its role is not allowed to use. */
export class AccessDeniedError extends Error {
  constructor() {
    super('That is not available here.')
    this.name = 'AccessDeniedError'
  }
}

/** The bits of Electron's `ipcMain` and invoke event this needs, so it can be tested with fakes. */
export interface IpcEventLike {
  sender: { id: number; mainFrame?: unknown }
  senderFrame?: unknown
}
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void
  on(channel: string, listener: (event: IpcEventLike & { returnValue?: unknown }) => void): void
}

export interface IpcDeps {
  ipc: IpcMainLike
  /** One implementation per role; a role with no entry can call nothing. */
  apis: Partial<Record<Role, ApiContract>>
  roleOf: (sender: { id: number }) => Role | undefined
  /**
   * Extra checks and work that depend on state (for example "the vault is locked", or a backup
   * before a delete); throw or reject to refuse.
   */
  beforeCall?: (role: Role, ns: string, method: string, access: Access) => void | Promise<void>
}

/**
 * Registers one IPC handler per API method. Every call is checked against the access policy using
 * the role the main process recorded for the calling window, and only from its top frame (a PDF or
 * document preview inside an iframe can never call the API). Fails fast at startup if an
 * implementation has drifted from the shared method list.
 */
export function registerIpc(deps: IpcDeps): void {
  for (const [role, api] of Object.entries(deps.apis) as [Role, ApiContract][]) {
    for (const ns of Object.keys(API_METHODS) as (keyof ApiContract)[]) {
      const declared = [...API_METHODS[ns]].sort()
      const actual = Object.keys(api[ns]).sort()
      if (declared.join() !== actual.join()) {
        throw new Error(`API namespace "${ns}" for ${role} is out of sync with API_METHODS`)
      }
    }
  }

  // A window asks once, synchronously, at startup which role it has (used to shape `window.api`).
  deps.ipc.on('tos:role', (event) => {
    event.returnValue = deps.roleOf(event.sender) ?? null
  })

  for (const ns of Object.keys(API_METHODS) as (keyof ApiContract)[]) {
    for (const method of API_METHODS[ns] as readonly string[]) {
      deps.ipc.handle(`${ns}.${method}`, async (event, ...args: unknown[]) => {
        const role = deps.roleOf(event.sender)
        const access = accessFor(ns, method)
        const fromTopFrame =
          event.senderFrame != null && event.senderFrame === event.sender.mainFrame
        const api = role ? deps.apis[role] : undefined
        if (!role || !access || !api || !fromTopFrame || !access.roles.includes(role)) {
          console.warn(`[ipc] refused ${ns}.${method} from ${role ?? 'unknown window'}`)
          throw new AccessDeniedError()
        }
        try {
          await deps.beforeCall?.(role, ns, method, access)
          const fn = (api[ns] as unknown as Record<string, (...a: unknown[]) => unknown>)[method]
          return await fn(...args)
        } catch (err) {
          // Messages from ValidationError and AccessDeniedError are written for the user; anything
          // else is logged and made generic.
          if (err instanceof ValidationError || err instanceof AccessDeniedError) throw err
          console.error(`[ipc] ${ns}.${method} failed:`, err)
          throw new Error('Something went wrong saving that. Nothing was changed.', { cause: err })
        }
      })
    }
  }
}
