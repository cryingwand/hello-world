import { useState } from 'react'
import { groupCount, makeGroups, type GroupSpec } from '@shared/tools'
import { showOnStage, useStageLink } from './stageLink'

/** Splits the names into groups of nearly equal size, in a fresh random order each time. */
export default function GroupsTool({ names }: { names: string[] }): React.JSX.Element {
  const [by, setBy] = useState<GroupSpec['by']>('groups')
  const [amount, setAmount] = useState('4')
  const [groups, setGroups] = useState<string[][]>([])
  const [copied, setCopied] = useState(false)
  const stage = useStageLink()
  const onStage = stage.tool === 'groups'

  const n = Math.floor(Number(amount))
  const valid = Number.isFinite(n) && n >= 1
  const spec: GroupSpec = by === 'groups' ? { by, count: n } : { by, size: n }
  const preview = valid ? groupCount(names.length, spec) : 0

  const make = (): void => {
    if (!valid || names.length === 0) return
    const next = makeGroups(names, spec, Math.random)
    setGroups(next)
    setCopied(false)
    // Shuffling again while the groups are up puts the new groups up.
    if (onStage) showOnStage({ kind: 'groups', groups: next }).catch(() => undefined)
  }
  const copy = async (): Promise<void> => {
    const text = groups.map((g, i) => `Group ${i + 1}: ${g.join(', ')}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="tools-groups">
      {names.length === 0 ? (
        <p className="hint">Add some names on the left to split into groups.</p>
      ) : (
        <>
          <div className="row tools-actions">
            <label className="inline">
              Make
              <select
                value={by}
                onChange={(e) => setBy(e.target.value as GroupSpec['by'])}
                aria-label="How to split"
              >
                <option value="groups">this many groups</option>
                <option value="size">groups of about</option>
              </select>
            </label>
            <input
              className="narrow"
              value={amount}
              inputMode="numeric"
              aria-label={by === 'groups' ? 'Number of groups' : 'People per group'}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="btn btn-primary" disabled={!valid} onClick={make}>
              {groups.length === 0 ? 'Make groups' : 'Shuffle again'}
            </button>
            {groups.length > 0 && (
              <button className="btn" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy as text'}
              </button>
            )}
            {groups.length > 0 && (
              <button
                className={`btn${onStage ? ' btn-primary' : ''}`}
                disabled={!stage.showing}
                title={stage.showing ? undefined : 'Start the Stage in the Presenter first'}
                onClick={() =>
                  showOnStage(onStage ? null : { kind: 'groups', groups }).catch(() => undefined)
                }
              >
                {onStage ? 'Back to the file' : 'Show on the Stage'}
              </button>
            )}
          </div>
          <p className="hint">
            {valid
              ? `${names.length} names into ${preview} ${preview === 1 ? 'group' : 'groups'}, no group more than one person bigger than another.`
              : 'Enter a whole number, 1 or more.'}
          </p>
          {groups.length > 0 && (
            <div className="group-grid">
              {groups.map((g, i) => (
                <section key={i} className="group-card" aria-label={`Group ${i + 1}`}>
                  <h4>
                    Group {i + 1} <span className="hint">({g.length})</span>
                  </h4>
                  <ul>
                    {g.map((name, j) => (
                      <li key={j}>{name}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
