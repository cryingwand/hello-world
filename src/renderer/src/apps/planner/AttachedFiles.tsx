import { useState } from 'react'
import { baseName, dirName, preferredApp } from '@shared/files'
import { useApiQuery } from '@renderer/data/hooks'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Files attached to a unit or a lesson: lesson handouts, slides, an answer key in a protected folder. */
export default function AttachedFiles({
  recordType,
  recordId,
  onError
}: {
  recordType: 'unit' | 'lesson'
  recordId: number
  onError: (message: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const links = useApiQuery(
    async () => {
      const list = await window.api.fileLinks.list(recordType, recordId)
      return Promise.all(
        list.map(async (link) => ({ link, info: await window.api.files.info(link.path) }))
      )
    },
    [recordType, recordId],
    ['fileLinks.changed']
  )

  const attach = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await window.api.files.pickFile()
      if (path) await window.api.fileLinks.add({ path, recordType, recordId })
    } catch (e) {
      onError(msg(e))
    } finally {
      setBusy(false)
    }
  }
  const open = (path: string): void => {
    window.api.files
      .open({ path, app: preferredApp(path), snap: false })
      .then((res) => {
        if (!res.opened) onError(res.message ?? 'That file could not be opened')
      })
      .catch((e: unknown) => onError(msg(e)))
  }

  const rows = links.data ?? []
  return (
    <section className="adv-section">
      <h3>
        {recordType === 'unit' ? 'Unit files' : 'Lesson files'}
        <button className="btn" disabled={busy} onClick={() => void attach()}>
          + Attach file
        </button>
      </h3>
      {rows.length === 0 ? (
        <p className="hint">No files attached. Handouts, slides or readings can be linked here.</p>
      ) : (
        <ul className="adv-list">
          {rows.map(({ link, info }) => (
            <li key={link.id} className="adv-item">
              <span className="adv-grow">
                <strong>{baseName(link.path)}</strong>
                <span className="hint pl-path">
                  {info ? dirName(link.path) : 'File not found. It may have been moved or deleted.'}
                </span>
              </span>
              <button className="btn btn-quiet" disabled={!info} onClick={() => open(link.path)}>
                Open
              </button>
              <button
                className="btn btn-quiet"
                disabled={!info}
                onClick={() => window.api.files.reveal(link.path).catch((e) => onError(msg(e)))}
              >
                Show
              </button>
              <button
                className="btn btn-quiet"
                onClick={() => window.api.fileLinks.remove(link.id).catch((e) => onError(msg(e)))}
              >
                Detach
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
