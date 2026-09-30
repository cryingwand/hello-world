import { BrowserWindow } from 'electron'
import { CHANGE_CHANNEL, type ChangeEvent } from '@shared/events'
import type { Emit } from './repos/types'

/** Broadcasts a change to every open window so each can refetch what it shows. */
export const broadcastChange: Emit = (name, detail) => {
  const event: ChangeEvent = { name, ...detail }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANGE_CHANNEL, event)
  }
}
