import { useState } from 'react'
import { baseName, dirName, kindOf } from '@shared/files'
import { useApiQuery } from '@renderer/data/hooks'
import RecordPicker, { type RecordRef } from './RecordPicker'

export default function AttachedTab({
  selected,
  onSelect
}: {
  selected: string | null
  onSelect: (path: string) => void
}): React.JSX.Element {
  const [target, setTarget] = useState<RecordRef | null>(null)
  const [error, setError] = useState<string | null>(null)
  const links = useApiQuery(
    async () => {
      if (!target) return []
      const list = await window.api.fileLinks.list(target.recordType, target.recordId)
      return Promise.all(
        list.map(async (l) => ({ link: l, info: await window.api.files.info(l.path) }))
      )
    },
    [target?.recordType, target?.recordId],
    ['fileLinks.changed']
  )

  return (
    <div className="attached">
      <RecordPicker value={target} onChange={setTarget} />
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {target && (
        <ul className="result-list">
          {(links.data ?? []).map(({ link, info }) => (
            <li key={link.id} className={`result${selected === link.path ? ' result-active' : ''}`}>
              <button className="result-main" disabled={!info} onClick={() => onSelect(link.path)}>
                <span className={`kind kind-${kindOf(link.path)}`}>{kindOf(link.path)}</span>
                <span className="result-text">
                  <span className="result-name">{baseName(link.path)}</span>
                  <span className="hint">
                    {info
                      ? dirName(link.path)
                      : 'File not found. It may have been moved or deleted.'}
                  </span>
                </span>
              </button>
              <button
                className="btn btn-quiet"
                onClick={() =>
                  window.api.fileLinks
                    .remove(link.id)
                    .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                }
              >
                Detach
              </button>
            </li>
          ))}
          {links.data && links.data.length === 0 && (
            <li className="hint pad">No files attached yet.</li>
          )}
        </ul>
      )}
    </div>
  )
}
