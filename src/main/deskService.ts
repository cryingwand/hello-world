import { stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import {
  AREA_COLORS,
  kindOf,
  type DeskArea,
  type DeskItem,
  type DeskPatch,
  type DeskPin
} from '@shared/files'
import type { FileGuard } from './protected'
import type { PublicRepositories } from './repos'
import type { DeskRow } from './repos/desk'
import * as v from './validate'

/** Most things one desktop may hold. */
export const MAX_DESK_ITEMS = 400
const LIMIT = 100_000
/** A pinned file's card and a folder's (which lists what is in it). */
export const FILE_CARD = { w: 120, h: 112 }
export const FOLDER_CARD = { w: 260, h: 240 }
const MIN_AREA = { w: 160, h: 120 }
const MIN_FOLDER = { w: 180, h: 120 }

const coord = (value: unknown, field: string): number => {
  const n = v.num(value, field, -LIMIT)
  if (n > LIMIT) throw new v.ValidationError(`${field} is too far away`)
  return Math.round(n)
}
const size = (value: unknown, field: string, min: number): number => {
  const n = v.num(value, field, 0)
  return Math.round(Math.min(Math.max(n, min), 20_000))
}
const color = (value: unknown, fallback: string): string =>
  value === undefined ? fallback : v.oneOf(value, AREA_COLORS, 'Colour')

/**
 * The everyday desktop's arrangement: files and folders pinned to the canvas and the areas that group
 * them. A pin is a pointer to a file on the Mac, never a copy; removing one leaves the file alone. A
 * protected file cannot be pinned, and one in a folder protected later is not shown.
 */
export function createDeskService(repo: PublicRepositories['desk'], guard: FileGuard) {
  const kindAt = async (path: string): Promise<'file' | 'folder' | null> => {
    const st = await stat(path).catch(() => null)
    if (!st) return null
    return st.isDirectory() ? 'folder' : st.isFile() ? 'file' : null
  }

  const toItem = async (row: DeskRow): Promise<DeskItem> => {
    const found = row.path ? await kindAt(row.path) : null
    return {
      id: row.id,
      kind: row.kind,
      path: row.path,
      label: row.label,
      color: row.color,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
      fileKind: row.kind === 'file' && row.path ? kindOf(row.path) : 'other',
      missing: row.kind !== 'area' && found !== row.kind
    }
  }
  const must = (rawId: unknown): DeskRow => {
    const row = repo.get(v.id(rawId))
    if (!row) throw new v.ValidationError('That is no longer on the desktop')
    return row
  }
  const roomForOne = (): void => {
    if (repo.count() >= MAX_DESK_ITEMS) {
      throw new v.ValidationError('The desktop is full. Remove something first.')
    }
  }

  return {
    async items(): Promise<DeskItem[]> {
      const snap = await guard.snapshot()
      const out: DeskItem[] = []
      for (const row of repo.list()) {
        if (row.path && (await snap.has(row.path))) continue
        out.push(await toItem(row))
      }
      return out
    },

    async pin(input: DeskPin): Promise<DeskItem> {
      const kind = v.oneOf(input?.kind, ['file', 'folder'] as const, 'Kind')
      if (typeof input.path !== 'string' || input.path.includes('\0') || !isAbsolute(input.path)) {
        throw new v.ValidationError('That is not a valid location')
      }
      const path = resolve(input.path)
      await guard.assertReadable(path)
      if ((await kindAt(path)) !== kind) {
        throw new v.ValidationError(
          kind === 'file' ? 'That file is no longer there' : 'That folder is no longer there'
        )
      }
      roomForOne()
      const card = kind === 'file' ? FILE_CARD : FOLDER_CARD
      return toItem(
        repo.insert({
          kind,
          path,
          label: basename(path) || path,
          color: '',
          x: coord(input.x, 'x'),
          y: coord(input.y, 'y'),
          ...card
        })
      )
    },

    async addArea(input: DeskArea): Promise<DeskItem> {
      roomForOne()
      return toItem(
        repo.insert({
          kind: 'area',
          path: null,
          label: v.optStr(input?.label, 'Label', 120),
          color: color(input.color, AREA_COLORS[0]),
          x: coord(input.x, 'x'),
          y: coord(input.y, 'y'),
          w: size(input.w, 'Width', MIN_AREA.w),
          h: size(input.h, 'Height', MIN_AREA.h)
        })
      )
    },

    /**
     * Moves, resizes, relabels or recolours items, all in one change: dragging an area carries the
     * things on it. Only an area's label and colour can change, and files keep their card size.
     */
    async arrange(changes: { id: number; patch: DeskPatch }[]): Promise<DeskItem[]> {
      if (!Array.isArray(changes) || changes.length > MAX_DESK_ITEMS) {
        throw new v.ValidationError('Nothing to arrange')
      }
      const rows = changes.map(({ id, patch }) => {
        const row = must(id)
        const p = patch ?? {}
        const resizable = row.kind !== 'file'
        const min = row.kind === 'area' ? MIN_AREA : MIN_FOLDER
        return {
          id: row.id,
          x: p.x !== undefined ? coord(p.x, 'x') : row.x,
          y: p.y !== undefined ? coord(p.y, 'y') : row.y,
          w: resizable && p.w !== undefined ? size(p.w, 'Width', min.w) : row.w,
          h: resizable && p.h !== undefined ? size(p.h, 'Height', min.h) : row.h,
          label:
            row.kind === 'area' && p.label !== undefined
              ? v.optStr(p.label, 'Label', 120)
              : row.label,
          color: row.kind === 'area' ? color(p.color, row.color) : row.color
        }
      })
      if (rows.length > 0) repo.update(rows)
      return Promise.all(rows.map((r) => toItem(repo.get(r.id)!)))
    },

    /** Takes it off the desktop. A pinned file or folder stays where it is on the Mac. */
    async remove(rawId: number): Promise<void> {
      repo.remove(must(rawId).id)
    }
  }
}

export type DeskService = ReturnType<typeof createDeskService>
