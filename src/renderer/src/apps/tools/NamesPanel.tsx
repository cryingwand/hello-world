import { MAX_NAMES } from '@shared/tools'
import { setNamesText, useNames } from './namesStore'

/** Where the names for the picker, groups and seating chart are typed or pasted, once for all three. */
export default function NamesPanel(): React.JSX.Element {
  const { text, names, dropped } = useNames()
  return (
    <aside className="sidebar tools-names" aria-label="Names">
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
        These names are kept in memory only. They are never saved or sent anywhere, and they are
        gone when you quit. This window cannot see your students, so type or paste what you want to
        show.
      </p>
    </aside>
  )
}
