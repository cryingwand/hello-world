import { useRef, useState } from 'react'
import { preferredApp, type FolderEntry } from '@shared/files'
import ContextMenu, { type MenuItem } from '@renderer/components/ContextMenu'
import Icon from '@renderer/components/Icon'
import { useApiQuery } from '@renderer/data/hooks'
import { useShell } from '@renderer/shell/ShellContext'
import { viewport } from '@renderer/shell/windowManager'
import { when } from './format'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** What a drag out of the browser carries: to another folder (a move) or to the desktop (a pin). */
export const PATHS_TYPE = 'application/x-tos-paths'
export interface DraggedPath {
  path: string
  isDir: boolean
}

/** The badge in front of a file's name: its kind, or a folder. */
export function KindBadge({
  entry
}: {
  entry: Pick<FolderEntry, 'isDir' | 'kind'>
}): React.JSX.Element {
  if (entry.isDir) {
    return (
      <span className="kind kind-folder">
        <Icon name="folder" size={13} />
      </span>
    )
  }
  return (
    <span className={`kind kind-${entry.kind}`}>
      {entry.kind === 'spreadsheet' ? 'xls' : entry.kind === 'other' ? '···' : entry.kind}
    </span>
  )
}

/**
 * The Mac's folders, like a Finder window: places on top, then the folder's contents. Click a file to
 * preview it, double-click a folder to go in. Drag files onto a folder to move them there, or out onto
 * the desktop to pin them. Right-click for the rest. Changes made in Finder show up on their own.
 */
export default function FolderBrowser({
  goTo,
  goToNonce,
  selected,
  onSelectFile,
  onError,
  canPin
}: {
  /** A folder to show, from an intent; followed each time the nonce changes. */
  goTo: string | null
  goToNonce: number
  selected: string | null
  onSelectFile: (path: string) => void
  onError: (message: string) => void
  /** Pinning to the desktop exists in the everyday window only. */
  canPin: boolean
}): React.JSX.Element {
  const places = useApiQuery(() => window.api.folders.places(), [], ['settings.changed'])
  const [dir, setDir] = useState<string | null>(null)
  // The selection belongs to the folder it was made in, so it does not carry over to another.
  const [pickedIn, setPickedIn] = useState<{ dir: string | null; paths: Set<string> }>({
    dir: null,
    paths: new Set()
  })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FolderEntry | null } | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const fail = (e: unknown): void => onError(msg(e))
  const { state } = useShell()

  const [seenNonce, setSeenNonce] = useState(0)
  if (goTo && goToNonce !== seenNonce) {
    setSeenNonce(goToNonce)
    setDir(goTo)
  }
  const current = dir ?? places.data?.[0]?.path ?? null

  const listing = useApiQuery(
    () => (current ? window.api.folders.list(current) : Promise.resolve(null)),
    [current],
    ['folders.changed', 'protection.changed']
  )
  const l = listing.data
  const picked = pickedIn.dir === current ? pickedIn.paths : new Set<string>()
  const setPicked = (paths: Set<string>): void => setPickedIn({ dir: current, paths })

  const open = (entry: FolderEntry): void => {
    if (entry.isDir) setDir(entry.path)
    else onSelectFile(entry.path)
  }
  const click = (e: React.MouseEvent, entry: FolderEntry): void => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(picked)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      setPicked(next)
      return
    }
    setPicked(new Set([entry.path]))
    if (!entry.isDir) onSelectFile(entry.path)
  }
  const chosen = (entry: FolderEntry): string[] =>
    picked.has(entry.path) ? [...picked] : [entry.path]

  const newFolder = (): void => {
    if (!l) return
    const name = window.prompt('Name of the new folder', 'New folder')
    if (!name) return
    window.api.folders
      .createFolder(l.path, name)
      .then((made) => setPicked(new Set([made])))
      .catch(fail)
  }
  const trash = (paths: string[]): void => {
    const what = paths.length === 1 ? `“${paths[0].split('/').pop()}”` : `${paths.length} items`
    if (!window.confirm(`Move ${what} to the Trash? You can put it back from the Trash in Finder.`))
      return
    window.api.folders.trash(paths).catch(fail)
  }
  /** Onto the middle of what the desktop is showing; it can be dragged from there. */
  const pin = (entry: Pick<FolderEntry, 'path' | 'isDir'>): void => {
    const view = viewport(state)
    window.api.desk
      .pin({
        kind: entry.isDir ? 'folder' : 'file',
        path: entry.path,
        x: view.x + view.w / 2 - 60,
        y: view.y + view.h / 2 - 60
      })
      .catch(fail)
  }
  const moveInto = (paths: string[], target: string): void => {
    const fromHere = paths.filter((p) => p !== target)
    if (fromHere.length > 0) window.api.folders.move(fromHere, target).catch(fail)
  }

  const itemsFor = (entry: FolderEntry | null): (MenuItem | null)[] => {
    if (!entry) {
      return [
        { label: 'New folder', onSelect: newFolder, disabled: !l?.writable },
        {
          label: 'Show in Finder',
          onSelect: () => l && window.api.files.reveal(l.path).catch(fail)
        }
      ]
    }
    const paths = chosen(entry)
    const many = paths.length > 1
    return [
      { label: entry.isDir ? 'Open' : 'Preview', onSelect: () => open(entry), disabled: many },
      ...(!entry.isDir
        ? [
            {
              label: `Open in ${preferredApp(entry.path) === 'default' ? 'its app' : preferredApp(entry.path).replace('Microsoft ', '')}`,
              onSelect: () =>
                window.api.files
                  .open({ path: entry.path, app: preferredApp(entry.path), snap: false })
                  .catch(fail),
              disabled: many
            }
          ]
        : []),
      ...(canPin ? [{ label: 'Pin to desktop', onSelect: () => pin(entry), disabled: many }] : []),
      {
        label: 'Show in Finder',
        onSelect: () => window.api.files.reveal(entry.path).catch(fail),
        disabled: many || entry.isDir
      },
      null,
      {
        label: 'Rename',
        onSelect: () => setRenaming(entry.path),
        disabled: many || !l?.writable
      },
      {
        label: 'Move to Trash',
        onSelect: () => trash(paths),
        danger: true,
        disabled: !l?.writable
      }
    ]
  }

  const entries = l?.entries ?? []
  const crumbs = l ? l.path.split('/').filter(Boolean) : []

  return (
    <div className="browser">
      <div className="places" role="list" aria-label="Places">
        {(places.data ?? []).map((p) => (
          <button
            key={p.path}
            role="listitem"
            className={`place${current === p.path ? ' place-on' : ''}`}
            onClick={() => setDir(p.path)}
            title={p.path}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="browser-bar">
        <button
          className="btn btn-quiet"
          disabled={!l?.parent}
          onClick={() => l?.parent && setDir(l.parent)}
          aria-label="Enclosing folder"
          title="Enclosing folder"
          onDragOver={(e) => l?.parent && l.writable && e.preventDefault()}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(PATHS_TYPE)
            if (raw && l?.parent)
              moveInto(
                (JSON.parse(raw) as DraggedPath[]).map((d) => d.path),
                l.parent
              )
          }}
        >
          ↑
        </button>
        <span className="crumbs" title={l?.path}>
          {crumbs.length > 2 && '… / '}
          {crumbs.slice(-2).join(' / ') || '/'}
        </span>
        <button
          className="btn btn-quiet"
          onClick={newFolder}
          disabled={!l?.writable}
          title={l?.writable ? 'New folder' : 'Folders can be made inside your home folder'}
        >
          + Folder
        </button>
        {canPin && l && (
          <button
            className="btn btn-quiet"
            title="Pin this folder to the desktop"
            onClick={() => pin({ path: l.path, isDir: true })}
          >
            Pin
          </button>
        )}
      </div>

      {listing.error && <p className="hint">{listing.error}</p>}
      <ul
        className="result-list browser-list"
        aria-label={l ? `Contents of ${l.name}` : 'Folder'}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, entry: null })
        }}
      >
        {entries.map((entry) => (
          <li
            key={entry.path}
            className={`result${picked.has(entry.path) || selected === entry.path ? ' result-active' : ''}${dropOn === entry.path ? ' result-drop' : ''}`}
            onDragOver={(e) => {
              if (!entry.isDir || !e.dataTransfer.types.includes(PATHS_TYPE)) return
              e.preventDefault()
              setDropOn(entry.path)
            }}
            onDragLeave={() => setDropOn(null)}
            onDrop={(e) => {
              setDropOn(null)
              const raw = e.dataTransfer.getData(PATHS_TYPE)
              if (!raw || !entry.isDir) return
              e.preventDefault()
              moveInto(
                (JSON.parse(raw) as DraggedPath[]).map((d) => d.path),
                entry.path
              )
            }}
          >
            {renaming === entry.path ? (
              <RenameField
                entry={entry}
                onDone={(name) => {
                  setRenaming(null)
                  if (name && name !== entry.name)
                    window.api.folders.rename(entry.path, name).catch(fail)
                }}
              />
            ) : (
              <button
                className="result-main"
                draggable
                onDragStart={(e) => {
                  const paths = chosen(entry)
                  const items: DraggedPath[] = paths.map((p) => ({
                    path: p,
                    isDir: entries.find((x) => x.path === p)?.isDir ?? false
                  }))
                  e.dataTransfer.setData(PATHS_TYPE, JSON.stringify(items))
                  e.dataTransfer.setData('text/plain', entry.name)
                  e.dataTransfer.effectAllowed = 'copyMove'
                }}
                onClick={(e) => click(e, entry)}
                onDoubleClick={() => open(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') open(entry)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!picked.has(entry.path)) setPicked(new Set([entry.path]))
                  setMenu({ x: e.clientX, y: e.clientY, entry })
                }}
                title={entry.path}
              >
                <KindBadge entry={entry} />
                <span className="result-text">
                  <span className="result-name">{entry.name}</span>
                  <span className="hint">{when(entry.mtime)}</span>
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {l && l.entries.length === 0 && <p className="hint">This folder is empty.</p>}
      {l?.truncated && <p className="hint">Only the first 2,000 items are listed.</p>}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={itemsFor(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function RenameField({
  entry,
  onDone
}: {
  entry: FolderEntry
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const [name, setName] = useState(entry.name)
  // Escape and the blur that follows must not both finish it.
  const finished = useRef(false)
  const finish = (value: string | null): void => {
    if (finished.current) return
    finished.current = true
    onDone(value)
  }
  return (
    <input
      className="rename-field"
      aria-label={`New name for ${entry.name}`}
      value={name}
      autoFocus
      onFocus={(e) => {
        // Select the name without its extension, as Finder does.
        const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.')
        e.currentTarget.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
      }}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => finish(name.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}
