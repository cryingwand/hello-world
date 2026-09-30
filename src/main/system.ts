import { app, dialog } from 'electron'

export async function chooseFolderDialog(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
}

export const appVersion = (): string => app.getVersion()
