import { useState } from 'react'
import { MAX_NAMES } from '@shared/tools'
import { useApiQuery } from '@renderer/data/hooks'
import { classLabel } from '@renderer/lib/labels'
import { setNamesText, useNames } from './namesStore'

/** Where the names for the picker, groups and seating chart are typed or pasted, once for all three. */
export default function NamesPanel(): React.JSX.Element {
  const { text, names, dropped } = useNames()
  const [error, setError] = useState<string | null>(null)
  // The names-only copy of your rosters. It is readable here even while the Vault is locked; the Vault
  // is where rosters are edited, and it refreshes this copy whenever they change.
  const classes = useApiQuery(() => window.api.directory.classes(), [], ['directory.changed'])
  const list = classes.data ?? []

  const load = async (id: number): Promise<void> => {
    if (text.trim() !== '' && !window.confirm('Replace the names below with this class?')) return
    setError(null)
    try {
      const students = await window.api.directory.students(id)
      setNamesText(students.map((s) => s.name).join('\n'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <aside className="sidebar tools-names" aria-label="Names">
      <label className="tools-names-label">
        Load a class
        <select
          value=""
          disabled={list.length === 0}
          onChange={(e) => e.target.value && void load(Number(e.target.value))}
          aria-label="Load a class"
        >
          <option value="">
            {list.length === 0 ? 'No classes copied yet' : 'Choose a class…'}
          </option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)} ({c.termName}, {c.studentCount})
            </option>
          ))}
        </select>
      </label>
      {list.length === 0 && !classes.loading && (
        <p className="hint">
          The classes you are teaching are copied here, names only, each time the Vault is unlocked:
          those in the current term, and in any term whose end date has not passed. Mark a term as
          current in Classes &amp; Rosters.
        </p>
      )}
      {error && (
        <p className="hint warn" role="alert">
          {error}
        </p>
      )}
      <label className="tools-names-label">
        Names, one per line
        <textarea
          value={text}
          onChange={(e) => setNamesText(e.target.value)}
          placeholder={'Paste a column from a spreadsheet,\nor type one name per line.'}
          spellCheck={false}
          autoComplete="off"
          aria-describedby="tools-names-note"
        />
      </label>
      <div className="row">
        <span className="hint" role="status">
          {names.length} {names.length === 1 ? 'name' : 'names'}
        </span>
        <span className="spacer" />
        <button className="btn btn-quiet" disabled={text === ''} onClick={() => setNamesText('')}>
          Clear
        </button>
      </div>
      {dropped > 0 && (
        <p className="hint warn" role="alert">
          Only the first {MAX_NAMES} names are used. {dropped} left out.
        </p>
      )}
      <p className="hint" id="tools-names-note">
        These names are kept in memory only here. This tool never saves them, and they are gone when
        you quit. A class loads names only: no email, notes, tags or grades, which stay in the
        Vault.
      </p>
    </aside>
  )
}
