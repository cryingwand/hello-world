import type { Role } from '@shared/access'

/**
 * Which role each open window has. The main process assigns a role when it creates a window and
 * looks it up from the window's own `webContents` id on every call. Nothing the renderer says about
 * itself is ever trusted.
 */
export function createRoleRegistry<W>() {
  const entries = new Map<number, { role: Role; win: W }>()
  return {
    add(role: Role, contentsId: number, win: W): void {
      entries.set(contentsId, { role, win })
    },
    remove(contentsId: number): void {
      entries.delete(contentsId)
    },
    roleOf(sender: { id: number }): Role | undefined {
      return entries.get(sender.id)?.role
    },
    windows(role: Role): W[] {
      return [...entries.values()].filter((e) => e.role === role).map((e) => e.win)
    },
    first(role: Role): W | undefined {
      for (const e of entries.values()) if (e.role === role) return e.win
      return undefined
    },
    count(): number {
      return entries.size
    }
  }
}

export type RoleRegistry<W> = ReturnType<typeof createRoleRegistry<W>>
