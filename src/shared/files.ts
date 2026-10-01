import type { Rect } from './geometry'

export type FileKind = 'pdf' | 'image' | 'text' | 'rtf' | 'docx' | 'spreadsheet' | 'pptx' | 'other'

const KIND_BY_EXT: Record<string, FileKind> = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  rtf: 'rtf',
  docx: 'docx',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  pptx: 'pptx'
}

export const extOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
export const dirName = (path: string): string =>
  path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || '/'

export const kindOf = (path: string): FileKind => KIND_BY_EXT[extOf(path)] ?? 'other'

/** The apps a file can be handed to. `default` lets macOS pick. */
export const NATIVE_APPS = [
  'Preview',
  'TextEdit',
  'Microsoft Word',
  'Microsoft Excel',
  'Microsoft PowerPoint',
  'default'
] as const
export type NativeApp = (typeof NATIVE_APPS)[number]

const WORD = new Set(['docx', 'doc', 'docm', 'dotx'])
const EXCEL = new Set(['xlsx', 'xls', 'xlsm', 'csv', 'tsv'])
const POWERPOINT = new Set(['pptx', 'ppt', 'pptm', 'ppsx'])

/** The app Tyler most likely wants for a file; `default` when there is no obvious choice. */
export function preferredApp(path: string): NativeApp {
  const ext = extOf(path)
  const kind = kindOf(path)
  if (kind === 'pdf' || kind === 'image') return 'Preview'
  if (kind === 'text' || kind === 'rtf') return 'TextEdit'
  if (WORD.has(ext)) return 'Microsoft Word'
  if (EXCEL.has(ext)) return 'Microsoft Excel'
  if (POWERPOINT.has(ext)) return 'Microsoft PowerPoint'
  return 'default'
}

/** How the Files app shows a file inside the launcher. */
export type Viewer = 'pdf' | 'image' | 'text' | 'docx' | 'table' | 'thumbnail'

export function viewerFor(kind: FileKind): Viewer {
  switch (kind) {
    case 'pdf':
      return 'pdf'
    case 'image':
      return 'image'
    case 'text':
      return 'text'
    case 'docx':
      return 'docx'
    case 'spreadsheet':
      return 'table'
    default:
      return 'thumbnail' // rtf, pptx and anything else: Quick Look thumbnail plus "Open in..."
  }
}

export interface FileSearchQuery {
  text: string
  /** Only search inside the configured teaching folders. */
  teachingOnly: boolean
  /** Also match text inside files, not just names. Slower. */
  includeContents: boolean
  limit?: number
}

export interface FileSearchResult {
  path: string
  name: string
  dir: string
  kind: FileKind
  /** Inside one of the teaching folders; these are listed first. */
  isTeaching: boolean
  teachingFolder: string | null
  /** Milliseconds since the epoch. */
  mtime: number
  size: number
  /** In a protected folder. Only ever set for the Vault window; other windows never see these. */
  isProtected?: boolean
}

export interface FileSearchResponse {
  results: FileSearchResult[]
  truncated: boolean
  /** Set when search could not run at all (for example Spotlight is unavailable). */
  unavailable?: string
}

export interface FileInfo {
  path: string
  name: string
  kind: FileKind
  size: number
  mtime: number
  /** In a protected folder (only reported to the Vault window). */
  isProtected?: boolean
}

/** A folder the teacher marked protected. */
export interface ProtectedFolder {
  path: string
  /** False when it is not there right now (an unplugged drive); it is still protected. */
  exists: boolean
}

export interface ProtectedEntry {
  name: string
  path: string
  isDir: boolean
  kind: FileKind
  size: number
  mtime: number
}

/** One level of a protected folder, for browsing inside the Vault. */
export interface ProtectedListing {
  dir: string
  /** The folder above, or null at the protected folder itself. */
  parent: string | null
  entries: ProtectedEntry[]
  /** More entries exist than were listed. */
  truncated: boolean
}

export interface TextFile {
  text: string
  /** Pass back to `writeText` so a change made elsewhere is noticed instead of overwritten. */
  mtime: number
  truncated: boolean
}

export interface TableView {
  sheetNames: string[]
  sheet: string | null
  rows: string[][]
  truncated: boolean
}

export interface OpenRequest {
  path: string
  app: NativeApp
  /** Put the launcher on the left half and the app on the right half. */
  snap: boolean
}

export interface OpenResult {
  opened: boolean
  snapped: boolean
  /** macOS needs the Accessibility permission before windows can be positioned. */
  needsAccessibility?: boolean
  message?: string
}

/** A custom scheme serves PDFs and images to the renderer without exposing raw file: URLs. */
export const FILE_SCHEME = 'tos-file'

export function toFileUrl(path: string): string {
  return `${FILE_SCHEME}://local${path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`
}

/** The inverse of `toFileUrl`; null if the URL is not one of ours. */
export function fromFileUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${FILE_SCHEME}:` || u.hostname !== 'local') return null
  try {
    return decodeURIComponent(u.pathname)
  } catch {
    return null
  }
}

/** Left and right halves of a work area (the screen minus menu bar and dock). */
export function splitWorkArea(area: Rect): { left: Rect; right: Rect } {
  const half = Math.floor(area.width / 2)
  return {
    left: { x: area.x, y: area.y, width: half, height: area.height },
    right: { x: area.x + half, y: area.y, width: area.width - half, height: area.height }
  }
}

/** A place in the folder browser's sidebar. */
export interface FolderPlace {
  path: string
  name: string
  kind: 'home' | 'desktop' | 'documents' | 'downloads' | 'icloud' | 'teaching'
}

/** A file or folder in a folder listing. */
export interface FolderEntry {
  path: string
  name: string
  isDir: boolean
  /** For a folder, `other`. */
  kind: FileKind
  size: number
  mtime: number
}

/** One folder's contents, folders first. Protected files are left out outside the Vault. */
export interface FolderListing {
  path: string
  name: string
  /** The folder above, or null at the top of the disk. */
  parent: string | null
  entries: FolderEntry[]
  /** More entries exist than were listed. */
  truncated: boolean
  /** Files can be created, renamed, moved and trashed here (inside your home folder, not protected). */
  writable: boolean
}

/** Something placed on the everyday desktop: a pinned file or folder, or a labelled area. */
export interface DeskItem {
  id: number
  kind: 'file' | 'folder' | 'area'
  /** Null for an area. */
  path: string | null
  /** The file's name, or the area's label. */
  label: string
  /** An area's colour, one of `AREA_COLORS`. */
  color: string
  x: number
  y: number
  w: number
  h: number
  /** For a file, how it is shown and opened. */
  fileKind: FileKind
  /** The file or folder has been moved, renamed or deleted elsewhere. */
  missing: boolean
}

export const AREA_COLORS = ['blue', 'green', 'orange', 'purple', 'pink', 'grey'] as const

export interface DeskPin {
  kind: 'file' | 'folder'
  path: string
  x: number
  y: number
}

export interface DeskArea {
  label: string
  x: number
  y: number
  w: number
  h: number
  color?: string
}

export interface DeskPatch {
  x?: number
  y?: number
  w?: number
  h?: number
  label?: string
  color?: string
}
