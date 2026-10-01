import { baseName, kindOf } from '@shared/files'
import Icon from '@renderer/components/Icon'
import { useApiQuery } from '@renderer/data/hooks'
import { formatSize, shortDir, when } from './format'
import OpenBar from './OpenBar'
import Viewer from './Viewer'

/** One file: its name, where it is, the open-in-app bar and the built-in viewer. */
export default function FileDetail({
  path,
  onAttach,
  onDirtyChange
}: {
  path: string
  onAttach?: () => void
  onDirtyChange: (dirty: boolean) => void
}): React.JSX.Element {
  // A file moved or trashed from the folder browser (or Finder) shows as gone.
  const info = useApiQuery(() => window.api.files.info(path), [path], ['folders.changed'])

  if (info.data === null && !info.loading) {
    return (
      <p className="hint pad">This file could not be found. It may have been moved or deleted.</p>
    )
  }
  return (
    <>
      <div className="pane-head">
        <div className="file-title">
          <h2>
            {info.data?.isProtected && (
              <span className="lock-badge" title="Protected: only shown inside the Vault">
                <Icon name="lock" size={14} />
              </span>
            )}
            {baseName(path)}
          </h2>
          <div className="hint" title={path}>
            {shortDir(path)}
            {info.data
              ? ` · ${formatSize(info.data.size)} · modified ${when(info.data.mtime)}`
              : ''}
          </div>
        </div>
      </div>
      <OpenBar path={path} onAttach={onAttach} />
      <div className="viewer">
        <Viewer key={`${path}:${kindOf(path)}`} path={path} onDirtyChange={onDirtyChange} />
      </div>
    </>
  )
}
