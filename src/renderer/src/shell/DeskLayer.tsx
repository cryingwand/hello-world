import { useEffect, useRef, useState } from 'react'
import {
  AREA_COLORS,
  preferredApp,
  viewerFor,
  type DeskItem,
  type DeskPatch,
  type FolderEntry
} from '@shared/files'
import { KindBadge, PATHS_TYPE, type DraggedPath } from '@apps/files/FolderBrowser'
import ContextMenu, { type MenuItem } from '@renderer/components/ContextMenu'
import ErrorBanner from '@renderer/components/ErrorBanner'
import Icon from '@renderer/components/Icon'
import { useApiQuery } from '@renderer/data/hooks'
import { useShell } from './ShellContext'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const MOVE_THRESHOLD = 3

type Box = Pick<DeskItem, 'x' | 'y' | 'w' | 'h'>
type Menu = { x: number; y: number; items: (MenuItem | null)[] }

/** The canvas point under a screen point, given where the desktop is on screen. */
export function canvasPoint(
  clientX: number,
  clientY: number,
  desk: DOMRect,
  camera: { x: number; y: number; zoom: number }
): { x: number; y: number } {
  return {
    x: camera.x + (clientX - desk.left) / camera.zoom,
    y: camera.y + (clientY - desk.top) / camera.zoom
  }
}

const centreInside = (item: Box, area: Box): boolean => {
  const cx = item.x + item.w / 2
  const cy = item.y + item.h / 2
  return cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h
}

/**
 * The everyday desktop's own arrangement, drawn on the canvas under the windows: files and folders
 * pinned where the teacher wants them, and labelled areas ("Monday", "PHIL 101", "To grade") that
 * group them. Dragging an area brings what is on it. Everything is a pointer to the real file on the
 * Mac: removing a pin leaves the file alone, and Move to Trash is the only way to throw one away.
 */
/** A right-click on empty canvas: where on screen, and the canvas point under it. */
export interface CanvasClick {
  clientX: number
  clientY: number
  x: number
  y: number
  nonce: number
}

export default function DeskLayer({
  canvasClick
}: {
  canvasClick: CanvasClick | null
}): React.JSX.Element {
  const { state, dispatchIntent, setCanvasExtras } = useShell()
  const { camera } = state
  const items = useApiQuery(
    () => window.api.desk.items(),
    [],
    ['desk.changed', 'folders.changed', 'protection.changed']
  )
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  // Where things are while being dragged, before the move is saved.
  const [moving, setMoving] = useState<Record<number, Box>>({})
  const drag = useRef<{
    sx: number
    sy: number
    start: Record<number, Box>
    resize: boolean
    moved: boolean
  } | null>(null)
  const fail = (e: unknown): void => setError(msg(e))

  // The canvas's own right-click menu: a new area, or a file or folder pinned where it was clicked.
  const [seenClick, setSeenClick] = useState(0)
  if (canvasClick && canvasClick.nonce !== seenClick) {
    setSeenClick(canvasClick.nonce)
    const { x, y } = canvasClick
    setSelected(null)
    setMenu({
      x: canvasClick.clientX,
      y: canvasClick.clientY,
      items: [
        {
          label: 'New area here',
          onSelect: () =>
            window.api.desk
              .addArea({ label: '', x, y, w: 480, h: 320 })
              .then((made) => setEditing(made.id))
              .catch(fail)
        },
        {
          label: 'Pin a file here…',
          onSelect: () =>
            window.api.files
              .pickFile()
              .then((path) => (path ? window.api.desk.pin({ kind: 'file', path, x, y }) : null))
              .catch(fail)
        },
        {
          label: 'Pin a folder here…',
          onSelect: () =>
            window.api.system
              .chooseFolder()
              .then((path) => (path ? window.api.desk.pin({ kind: 'folder', path, x, y }) : null))
              .catch(fail)
        }
      ]
    })
  }

  const list = items.data ?? []
  const place = (item: DeskItem): DeskItem => ({ ...item, ...moving[item.id] })

  // Fit and the map frame these along with the windows.
  const data = items.data
  useEffect(() => {
    setCanvasExtras((data ?? []).map(({ x, y, w, h }) => ({ x, y, w, h })))
  }, [data, setCanvasExtras])
  useEffect(() => () => setCanvasExtras([]), [setCanvasExtras])

  // Delete or Backspace takes the selected thing off the desktop (never the file itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (selected === null || (e.key !== 'Delete' && e.key !== 'Backspace')) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable], .window')) return
      window.api.desk.remove(selected).catch(fail)
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const startDrag = (e: React.PointerEvent, item: DeskItem, resize = false): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelected(item.id)
    const carried =
      item.kind === 'area' && !resize
        ? list.filter((i) => i.kind !== 'area' && centreInside(place(i), place(item)))
        : []
    const start: Record<number, Box> = {}
    for (const i of [item, ...carried]) start[i.id] = { x: i.x, y: i.y, w: i.w, h: i.h }
    drag.current = { sx: e.clientX, sy: e.clientY, start, resize, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) / camera.zoom
    const dy = (e.clientY - d.sy) / camera.zoom
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < MOVE_THRESHOLD) return
    d.moved = true
    const next: Record<number, Box> = {}
    for (const [id, b] of Object.entries(d.start)) {
      next[Number(id)] = d.resize
        ? { ...b, w: Math.max(b.w + dx, 120), h: Math.max(b.h + dy, 90) }
        : { ...b, x: b.x + dx, y: b.y + dy }
    }
    setMoving(next)
  }
  const onDragEnd = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d?.moved) return
    const changes = Object.entries(moving).map(([id, b]) => ({
      id: Number(id),
      patch: (d.resize ? { w: b.w, h: b.h } : { x: b.x, y: b.y }) as DeskPatch
    }))
    window.api.desk
      .arrange(changes)
      .catch(fail)
      .finally(() => setMoving({}))
  }
  const dragHandlers = {
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd
  }

  /** Double-click: previewed in Files when it can be, otherwise opened in its own app. */
  const openFile = (path: string): void => {
    const kind = list.find((i) => i.path === path)?.fileKind
    if (kind && viewerFor(kind) !== 'thumbnail') {
      dispatchIntent({ type: 'open-path', path, isDir: false })
    } else {
      window.api.files.open({ path, app: preferredApp(path), snap: false }).catch(fail)
    }
  }
  const trash = (item: DeskItem): void => {
    if (!item.path) return
    if (
      !window.confirm(
        `Move “${item.label}” to the Trash? You can put it back from the Trash in Finder.`
      )
    )
      return
    window.api.folders
      .trash([item.path])
      .then(() => window.api.desk.remove(item.id))
      .catch(fail)
  }
  const renameFile = (item: DeskItem): void => {
    if (!item.path) return
    const name = window.prompt('New name', item.label)
    if (name && name !== item.label) window.api.folders.rename(item.path, name).catch(fail)
  }

  const menuFor = (item: DeskItem): (MenuItem | null)[] => {
    const off = {
      label: 'Remove from desktop',
      onSelect: () => window.api.desk.remove(item.id).catch(fail)
    }
    if (item.kind === 'area') {
      return [
        { label: 'Rename', onSelect: () => setEditing(item.id) },
        null,
        ...AREA_COLORS.map((c) => ({
          label: `${c === item.color ? '✓ ' : ''}${c[0].toUpperCase()}${c.slice(1)}`,
          onSelect: () =>
            window.api.desk.arrange([{ id: item.id, patch: { color: c } }]).catch(fail)
        })),
        null,
        { label: 'Remove area (keeps what is on it)', onSelect: off.onSelect, danger: true }
      ]
    }
    if (item.missing || !item.path) return [off]
    const path = item.path
    if (item.kind === 'folder') {
      return [
        {
          label: 'Open in Files',
          onSelect: () => dispatchIntent({ type: 'open-path', path, isDir: true })
        },
        { label: 'Rename…', onSelect: () => renameFile(item) },
        null,
        off,
        { label: 'Move to Trash', onSelect: () => trash(item), danger: true }
      ]
    }
    const app = preferredApp(path)
    return [
      { label: 'Open', onSelect: () => openFile(path) },
      ...(app !== 'default'
        ? [
            {
              label: `Open in ${app.replace('Microsoft ', '')}`,
              onSelect: () => window.api.files.open({ path, app, snap: true }).catch(fail)
            }
          ]
        : []),
      { label: 'Show in Finder', onSelect: () => window.api.files.reveal(path).catch(fail) },
      { label: 'Rename…', onSelect: () => renameFile(item) },
      null,
      off,
      { label: 'Move to Trash', onSelect: () => trash(item), danger: true }
    ]
  }
  const contextMenu = (e: React.MouseEvent, item: DeskItem): void => {
    e.preventDefault()
    e.stopPropagation()
    setSelected(item.id)
    setMenu({ x: e.clientX, y: e.clientY, items: menuFor(item) })
  }

  return (
    <>
      <div
        className="desk-layer"
        style={{
          transform: `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`
        }}
      >
        {list.map((raw) => {
          const item = place(raw)
          const style = { left: item.x, top: item.y, width: item.w, height: item.h }
          const on = selected === item.id ? ' desk-selected' : ''
          if (item.kind === 'area') {
            return (
              <section
                key={item.id}
                className={`desk-area area-${item.color || 'blue'}${on}`}
                style={style}
                aria-label={item.label || 'Area'}
              >
                <div
                  className="desk-item desk-area-bar"
                  onPointerDown={(e) => startDrag(e, raw)}
                  {...dragHandlers}
                  onDoubleClick={() => setEditing(item.id)}
                  onContextMenu={(e) => contextMenu(e, raw)}
                >
                  {editing === item.id ? (
                    <AreaLabel
                      item={item}
                      onDone={(label) => {
                        setEditing(null)
                        if (label !== null && label !== item.label)
                          window.api.desk.arrange([{ id: item.id, patch: { label } }]).catch(fail)
                      }}
                    />
                  ) : (
                    <span className="desk-area-label">{item.label || 'Untitled area'}</span>
                  )}
                </div>
                <div
                  className="desk-item desk-resize"
                  onPointerDown={(e) => startDrag(e, raw, true)}
                  {...dragHandlers}
                  aria-hidden="true"
                />
              </section>
            )
          }
          if (item.kind === 'folder') {
            return (
              <FolderCard
                key={item.id}
                item={item}
                className={on}
                onPointerDown={(e) => startDrag(e, raw)}
                onResizeDown={(e) => startDrag(e, raw, true)}
                dragHandlers={dragHandlers}
                onContextMenu={(e) => contextMenu(e, raw)}
                onOpenEntry={(entry) =>
                  entry.isDir
                    ? dispatchIntent({ type: 'open-path', path: entry.path, isDir: true })
                    : openFile(entry.path)
                }
                onError={fail}
              />
            )
          }
          return (
            <button
              key={item.id}
              className={`desk-item desk-file${on}${item.missing ? ' desk-missing' : ''}`}
              style={style}
              title={item.missing ? 'This file was moved or deleted' : (item.path ?? '')}
              onPointerDown={(e) => startDrag(e, raw)}
              {...dragHandlers}
              onDoubleClick={() => !item.missing && item.path && openFile(item.path)}
              onContextMenu={(e) => contextMenu(e, raw)}
            >
              <FileIcon item={item} />
              <span className="desk-file-name">{item.label}</span>
            </button>
          )
        })}
      </div>
      {error && (
        <div className="desk-error">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </>
  )
}

/** A preview of the file where macOS has one (Quick Look), otherwise its kind. */
function FileIcon({ item }: { item: DeskItem }): React.JSX.Element {
  const thumb = useApiQuery(
    () =>
      item.path && !item.missing ? window.api.files.thumbnail(item.path) : Promise.resolve(null),
    [item.path, item.missing]
  )
  return thumb.data ? (
    <img className="desk-thumb" src={thumb.data} alt="" draggable={false} />
  ) : (
    <span className="desk-badge">
      <KindBadge entry={{ isDir: false, kind: item.fileKind }} />
    </span>
  )
}

/**
 * A pinned folder shows what is in it, live. Files dragged from Files onto it are moved into it.
 */
function FolderCard({
  item,
  className,
  onPointerDown,
  onResizeDown,
  dragHandlers,
  onContextMenu,
  onOpenEntry,
  onError
}: {
  item: DeskItem
  className: string
  onPointerDown: (e: React.PointerEvent) => void
  onResizeDown: (e: React.PointerEvent) => void
  dragHandlers: Record<string, (e: React.PointerEvent) => void>
  onContextMenu: (e: React.MouseEvent) => void
  onOpenEntry: (entry: FolderEntry) => void
  onError: (e: unknown) => void
}): React.JSX.Element {
  const { dispatchIntent } = useShell()
  const [dropping, setDropping] = useState(false)
  const listing = useApiQuery(
    () => (item.path && !item.missing ? window.api.folders.list(item.path) : Promise.resolve(null)),
    [item.path, item.missing],
    ['folders.changed']
  )
  return (
    <section
      className={`desk-item desk-folder${className}${item.missing ? ' desk-missing' : ''}${dropping ? ' desk-drop' : ''}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
      aria-label={`Folder ${item.label}`}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PATHS_TYPE) || item.missing) return
        e.preventDefault()
        e.stopPropagation()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const raw = e.dataTransfer.getData(PATHS_TYPE)
        if (!raw || !item.path) return
        e.preventDefault()
        e.stopPropagation()
        const paths = (JSON.parse(raw) as DraggedPath[]).map((d) => d.path)
        window.api.folders.move(paths, item.path).catch(onError)
      }}
    >
      <header className="desk-folder-head" onPointerDown={onPointerDown} {...dragHandlers}>
        <Icon name="folder" size={16} />
        <span className="desk-folder-name">{item.label}</span>
        {item.path && !item.missing && (
          <button
            className="btn btn-quiet"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => dispatchIntent({ type: 'open-path', path: item.path!, isDir: true })}
          >
            Open
          </button>
        )}
      </header>
      {item.missing ? (
        <p className="hint pad">This folder was moved or deleted.</p>
      ) : (
        <ul className="desk-scroll desk-folder-list">
          {listing.data?.entries.map((entry) => (
            <li key={entry.path}>
              <button
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    PATHS_TYPE,
                    JSON.stringify([{ path: entry.path, isDir: entry.isDir }])
                  )
                  e.dataTransfer.setData('text/plain', entry.name)
                }}
                onDoubleClick={() => onOpenEntry(entry)}
                title={entry.name}
              >
                <KindBadge entry={entry} />
                <span>{entry.name}</span>
              </button>
            </li>
          ))}
          {listing.data?.entries.length === 0 && <li className="hint">Empty</li>}
          {listing.error && <li className="hint">{listing.error}</li>}
        </ul>
      )}
      <div
        className="desk-resize"
        onPointerDown={onResizeDown}
        {...dragHandlers}
        aria-hidden="true"
      />
    </section>
  )
}

function AreaLabel({
  item,
  onDone
}: {
  item: DeskItem
  onDone: (label: string | null) => void
}): React.JSX.Element {
  const [label, setLabel] = useState(item.label)
  const finished = useRef(false)
  const finish = (value: string | null): void => {
    if (finished.current) return
    finished.current = true
    onDone(value)
  }
  return (
    <input
      className="desk-area-input"
      aria-label="Area name"
      value={label}
      autoFocus
      maxLength={120}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setLabel(e.target.value)}
      onBlur={() => finish(label.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}
