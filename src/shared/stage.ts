import type { FileKind } from './files'

/** Main pushes the full state to the Presenter (launcher) whenever it changes. */
export const STAGE_STATE_CHANNEL = 'teachingos:stage-state'
/** Main pushes what to show to the Stage window whenever it changes. */
export const STAGE_VIEW_CHANNEL = 'teachingos:stage-view'

/** The stage serves its queue under this host: `tos-file://stage/<index>`. No paths ever reach it. */
export const STAGE_HOST = 'stage'
export const stageUrl = (index: number, version: number): string =>
  `tos-file://${STAGE_HOST}/${index}?v=${Math.trunc(version)}`

/** What the Stage can show itself. Anything else is opened in its own app from the Presenter. */
export const STAGE_KINDS = ['pdf', 'image', 'docx', 'text'] as const
export type StageKind = (typeof STAGE_KINDS)[number]
export const isStageKind = (kind: FileKind): kind is StageKind =>
  (STAGE_KINDS as readonly string[]).includes(kind)

export const MAX_STAGE_ITEMS = 100

export interface StageItemInfo {
  name: string
  kind: StageKind
}

/** What the Presenter sees. It never includes a path. */
export interface StageState {
  active: boolean
  items: StageItemInfo[]
  /** The item on the stage, or -1 when the queue is empty. */
  index: number
  blanked: boolean
  /** Displays other than the built-in one. The Stage fills the first of them, else this screen. */
  externalDisplays: number
  /** The setting that lets a newly connected display prompt a Stage offer. */
  offerEnabled: boolean
}

/** What the audience sees. */
export interface StageContent {
  name: string
  kind: StageKind
  /** pdf and image: a `tos-file://stage/<index>` URL. */
  url?: string
  /** docx: converted HTML, shown in a sandboxed frame. */
  html?: string
  /** text and markdown. */
  text?: string
  /** The file could not be shown. */
  message?: string
}

export interface StageView {
  active: boolean
  blanked: boolean
  index: number
  count: number
  content: StageContent | null
}

export type StageKeyAction = 'next' | 'previous' | 'blank' | 'end'

export interface StageKeyInput {
  key: string
  control?: boolean
  meta?: boolean
  alt?: boolean
}

/**
 * Keys on the Stage. Escape ends it, B or . blanks it, ] and [ (or Ctrl/Cmd with the arrow keys)
 * move between files. Arrows, Space and Page Up/Down also move between files, except while a PDF
 * is showing, where the PDF viewer keeps them for paging through the document.
 */
export function stageKeyAction(
  input: StageKeyInput,
  kind: StageKind | null
): StageKeyAction | null {
  if (input.alt) return null
  const key = input.key
  const command = !!(input.control || input.meta)
  if (key === 'Escape') return 'end'
  if (!command && (key === 'b' || key === 'B' || key === '.')) return 'blank'
  if (key === ']' || (command && key === 'ArrowRight')) return 'next'
  if (key === '[' || (command && key === 'ArrowLeft')) return 'previous'
  if (command || kind === 'pdf') return null
  if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ')
    return 'next'
  if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || key === 'Backspace')
    return 'previous'
  return null
}
