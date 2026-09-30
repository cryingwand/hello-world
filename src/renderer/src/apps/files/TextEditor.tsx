import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useCallback, useEffect, useRef, useState } from 'react'
import { extOf } from '@shared/files'
import { useApiQuery } from '@renderer/data/hooks'

const darkTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)' },
    '.cm-content': {
      caretColor: 'var(--accent)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '13px'
    },
    '.cm-gutters': { backgroundColor: 'var(--panel-2)', color: 'var(--muted)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.06)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#2f4270 !important'
    },
    '.cm-scroller': { overflow: 'auto' }
  },
  { dark: true }
)

/** Edits a .txt or .md file in place. Saving refuses if the file changed on disk meanwhile. */
export default function TextEditor({
  path,
  onDirtyChange
}: {
  path: string
  onDirtyChange: (dirty: boolean) => void
}): React.JSX.Element {
  const file = useApiQuery(() => window.api.files.readText(path), [path])
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const mtime = useRef(0)
  const saveRef = useRef<() => void>(() => undefined)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setDirtyBoth = useCallback(
    (d: boolean) => {
      setDirty(d)
      onDirtyChange(d)
    },
    [onDirtyChange]
  )

  const save = useCallback(async (): Promise<void> => {
    const v = view.current
    if (!v) return
    setError(null)
    try {
      const res = await window.api.files.writeText(path, v.state.doc.toString(), mtime.current)
      mtime.current = res.mtime
      setDirtyBoth(false)
      setStatus('Saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [path, setDirtyBoth])

  useEffect(() => {
    saveRef.current = () => void save()
  }, [save])

  const loaded = file.data
  useEffect(() => {
    if (!loaded || !host.current) return
    mtime.current = loaded.mtime
    const isMarkdown = ['md', 'markdown'].includes(extOf(path))
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: loaded.text,
        extensions: [
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                saveRef.current()
                return true
              }
            }
          ]),
          basicSetup,
          EditorView.lineWrapping,
          darkTheme,
          EditorState.readOnly.of(loaded.truncated),
          ...(isMarkdown ? [markdown()] : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              setDirtyBoth(true)
              setStatus(null)
            }
          })
        ]
      })
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
      onDirtyChange(false)
    }
  }, [loaded, path, setDirtyBoth, onDirtyChange])

  if (file.error) return <p className="hint pad">{file.error}</p>
  return (
    <div className="editor-wrap">
      <div className="editor-bar">
        <span className="hint">
          {loaded?.truncated
            ? 'Too large to edit here; showing the start (read-only).'
            : dirty
              ? 'Unsaved changes'
              : (status ?? 'Editing')}
        </span>
        <button
          className="btn btn-primary"
          disabled={!dirty || !!loaded?.truncated}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="editor" ref={host} aria-label="Text editor" />
    </div>
  )
}
