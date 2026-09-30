import { useEffect, useState } from 'react'
import { kindOf, toFileUrl, viewerFor } from '@shared/files'
import { useMasked } from '@renderer/components/Sensitive'
import { useApiQuery } from '@renderer/data/hooks'
import { PAPER_CSS } from './paper'
import TextEditor from './TextEditor'

function DocxView({ path }: { path: string }): React.JSX.Element {
  const doc = useApiQuery(() => window.api.files.docxHtml(path), [path])
  if (doc.error) return <p className="hint pad">{doc.error}</p>
  if (!doc.data) return <p className="hint pad">Loading…</p>
  // Sandboxed with no permissions: a document can never run script or navigate the app.
  return (
    <iframe
      title="Document preview"
      className="frame"
      sandbox=""
      srcDoc={`<!doctype html><meta charset="utf-8"><style>${PAPER_CSS}</style><body>${doc.data.html}</body>`}
    />
  )
}

function TableView({ path }: { path: string }): React.JSX.Element {
  const masked = useMasked()
  const [sheet, setSheet] = useState<string | null>(null)
  const table = useApiQuery(() => window.api.files.table(path, sheet), [path, sheet])
  // Spreadsheets are the likeliest place for grades; keep them off the projector.
  if (masked)
    return (
      <p className="hint pad">
        Spreadsheet previews are hidden while presenting. Use “Open in Excel”.
      </p>
    )
  if (table.error) return <p className="hint pad">{table.error}</p>
  const t = table.data
  if (!t) return <p className="hint pad">Loading…</p>
  return (
    <div className="table-view">
      <div className="editor-bar">
        <span className="hint">
          Read-only preview{t.truncated ? ' (first rows and columns only)' : ''}
        </span>
        {t.sheetNames.length > 1 && (
          <select
            value={t.sheet ?? ''}
            onChange={(e) => setSheet(e.target.value)}
            aria-label="Sheet"
          >
            {t.sheetNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        )}
      </div>
      <div className="table-scroll">
        <table className="grid-table">
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ThumbnailView({ path, hint }: { path: string; hint: string }): React.JSX.Element {
  const thumb = useApiQuery(() => window.api.files.thumbnail(path), [path])
  return (
    <div className="thumb-view">
      {thumb.data ? (
        <img src={thumb.data} alt="Thumbnail preview" />
      ) : (
        <div className="thumb-empty">{thumb.loading ? 'Loading…' : 'No preview available'}</div>
      )}
      <p className="hint">{hint}</p>
    </div>
  )
}

export default function Viewer({
  path,
  onDirtyChange
}: {
  path: string
  onDirtyChange: (dirty: boolean) => void
}): React.JSX.Element {
  const kind = kindOf(path)
  // A different file starts clean.
  useEffect(() => {
    onDirtyChange(false)
  }, [path, onDirtyChange])

  switch (viewerFor(kind)) {
    case 'pdf':
      return <iframe title="PDF preview" className="frame" src={toFileUrl(path)} />
    case 'image':
      return (
        <div className="image-view">
          <img src={toFileUrl(path)} alt="Preview" />
        </div>
      )
    case 'text':
      return <TextEditor key={path} path={path} onDirtyChange={onDirtyChange} />
    case 'docx':
      return <DocxView path={path} />
    case 'table':
      return <TableView path={path} />
    default:
      return (
        <ThumbnailView
          path={path}
          hint={
            kind === 'rtf'
              ? 'RTF files open best in TextEdit.'
              : kind === 'pptx'
                ? 'Open in PowerPoint to present or edit.'
                : 'Use “Open in” to view this file.'
          }
        />
      )
  }
}
