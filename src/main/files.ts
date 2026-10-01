import mammoth from 'mammoth'
import { chmod, open, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'
import type { FileInfo, TableView, TextFile } from '@shared/files'
import { baseName, extOf, fromFileUrl, kindOf } from '@shared/files'
import { readTable } from './tableIO'
import { ValidationError } from './validate'

export const MAX_TEXT_BYTES = 2 * 1024 * 1024
export const MAX_DOCX_BYTES = 30 * 1024 * 1024
export const MAX_TABLE_BYTES = 25 * 1024 * 1024
const TABLE_ROW_CAP = 500
const TABLE_COL_CAP = 60
const EDITABLE = new Set(['txt', 'md', 'markdown'])
/** Only these are ever served to the renderer through the custom protocol. */
const SERVED = new Set(['pdf', 'image'])

/** Requires an absolute path to an existing regular file; returns its stats. */
export async function assertFile(
  path: unknown,
  maxBytes?: number
): Promise<{ path: string; size: number; mtimeMs: number }> {
  if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) {
    throw new ValidationError('That is not a valid file path')
  }
  const clean = normalize(path)
  let st
  try {
    st = await stat(clean)
  } catch {
    throw new ValidationError('That file no longer exists')
  }
  if (!st.isFile()) throw new ValidationError('That is not a file')
  if (maxBytes !== undefined && st.size > maxBytes) {
    throw new ValidationError(
      `That file is too large to preview here (${Math.round(st.size / 1024 / 1024)} MB). Open it in its app instead.`
    )
  }
  return { path: clean, size: st.size, mtimeMs: st.mtimeMs }
}

export async function fileInfo(path: string): Promise<FileInfo | null> {
  try {
    const f = await assertFile(path)
    return {
      path: f.path,
      name: baseName(f.path),
      kind: kindOf(f.path),
      size: f.size,
      mtime: f.mtimeMs
    }
  } catch {
    return null
  }
}

export async function readText(path: string): Promise<TextFile> {
  const f = await assertFile(path)
  if (!EDITABLE.has(extOf(f.path)))
    throw new ValidationError('Only .txt and .md files can be edited here')
  // Read only what we will show; a huge log file must not be loaded whole.
  const truncated = f.size > MAX_TEXT_BYTES
  const handle = await open(f.path, 'r')
  let text: string
  try {
    const buf = Buffer.alloc(Math.min(f.size, MAX_TEXT_BYTES))
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    text = buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
  return { text, mtime: f.mtimeMs, truncated }
}

/**
 * Saves an edit. `expectedMtime` is the modification time returned when the file was opened; if the
 * file has changed since (another app, iCloud sync), refuse rather than silently overwrite it.
 */
export async function writeText(
  path: string,
  text: string,
  expectedMtime: number
): Promise<{ mtime: number }> {
  const f = await assertFile(path)
  if (!EDITABLE.has(extOf(f.path)))
    throw new ValidationError('Only .txt and .md files can be edited here')
  if (typeof text !== 'string') throw new ValidationError('Nothing to save')
  if (f.size > MAX_TEXT_BYTES)
    throw new ValidationError('This file is too large to edit here. Open it in TextEdit.')
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES)
    throw new ValidationError('That is too much text to save here.')
  if (Math.abs(f.mtimeMs - expectedMtime) > 1) {
    throw new ValidationError(
      'This file changed on disk since you opened it. Reopen it to see the latest version.'
    )
  }
  // Write beside the original and rename, so a crash mid-save cannot leave a half-written file.
  const tmp = `${f.path}.tos-save-${process.pid}`
  try {
    await writeFile(tmp, text, 'utf8')
    await chmod(tmp, (await stat(f.path)).mode & 0o777)
    await rename(tmp, f.path)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
  return { mtime: (await stat(f.path)).mtimeMs }
}

export async function docxHtml(path: string): Promise<{ html: string; messages: string[] }> {
  const f = await assertFile(path, MAX_DOCX_BYTES)
  if (extOf(f.path) !== 'docx')
    throw new ValidationError('Only .docx files can be previewed as a document')
  try {
    const res = await mammoth.convertToHtml({ path: f.path })
    return { html: res.value, messages: res.messages.map((m) => m.message).slice(0, 5) }
  } catch {
    throw new ValidationError('That document could not be read. Open it in Word instead.')
  }
}

export async function tableView(path: string, sheet?: string | null): Promise<TableView> {
  const f = await assertFile(path, MAX_TABLE_BYTES)
  const t = await readTable(f.path, sheet)
  const truncated = t.rows.length > TABLE_ROW_CAP || t.rows.some((r) => r.length > TABLE_COL_CAP)
  return {
    sheetNames: t.sheetNames,
    sheet: t.sheet,
    rows: t.rows.slice(0, TABLE_ROW_CAP).map((r) => r.slice(0, TABLE_COL_CAP)),
    truncated
  }
}

/**
 * Validates a tos-file:// URL and returns the path to serve. Only existing PDFs and images are
 * ever served, so the renderer cannot use the protocol to read arbitrary files.
 */
export async function resolveServedPath(
  url: string,
  /** Extra policy for the window asking, such as refusing protected files. Throws to refuse. */
  allow?: (path: string) => Promise<void>
): Promise<string> {
  const path = fromFileUrl(url)
  if (!path) throw new ValidationError('Bad file URL')
  const f = await assertFile(path)
  if (!SERVED.has(kindOf(f.path))) throw new ValidationError('That file type is not served')
  await allow?.(f.path)
  return f.path
}
