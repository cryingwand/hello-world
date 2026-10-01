import { app, dialog } from 'electron'
import { basename } from 'node:path'
import type { TableFormat } from './tableIO'

export async function chooseFolderDialog(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
}

export async function pickTableFile(): Promise<string | null> {
  const res = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xlsm', 'csv', 'tsv', 'txt'] }]
  })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
}

export async function pickSaveTableFile(
  defaultName: string,
  format: TableFormat
): Promise<string | null> {
  const res = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: format === 'xlsx' ? 'Excel workbook' : 'CSV', extensions: [format] }]
  })
  return res.canceled || !res.filePath ? null : res.filePath
}

export async function pickSaveDocxFile(defaultName: string): Promise<string | null> {
  const res = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'Word document', extensions: ['docx'] }]
  })
  return res.canceled || !res.filePath ? null : res.filePath
}

export async function pickSavePptxFile(defaultName: string): Promise<string | null> {
  const res = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'PowerPoint presentation', extensions: ['pptx'] }]
  })
  return res.canceled || !res.filePath ? null : res.filePath
}

/** For exports from the Vault: true to save outside the protected folders anyway. */
export async function confirmSaveOutsideDialog(path: string): Promise<boolean> {
  const res = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Choose another place', 'Save here anyway'],
    defaultId: 0,
    cancelId: 0,
    message: `Save “${basename(path)}” outside your protected folders?`,
    detail:
      'Files saved there show up in everyday file search and can be put on the Stage. Saving in a protected folder keeps them in the Vault.'
  })
  return res.response === 1
}

export async function pickAnyFile(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ properties: ['openFile'] })
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
}

export const appVersion = (): string => app.getVersion()
