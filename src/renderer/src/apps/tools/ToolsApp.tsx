import { useState } from 'react'
import type { AppProps } from '@apps/types'
import GroupsTool from './GroupsTool'
import NamesPanel from './NamesPanel'
import PickerTool from './PickerTool'
import SeatingTool from './SeatingTool'
import TimerTool from './TimerTool'
import { useNames } from './namesStore'

type Tab = 'timer' | 'picker' | 'groups' | 'seating'
const TABS: { id: Tab; label: string; needsNames: boolean }[] = [
  { id: 'timer', label: 'Timer', needsNames: false },
  { id: 'picker', label: 'Picker', needsNames: true },
  { id: 'groups', label: 'Groups', needsNames: true },
  { id: 'seating', label: 'Seating', needsNames: true }
]

/**
 * A timer, a random picker, a group maker and a seating chart. They work from names typed or pasted
 * here, never from your roster, so this window is safe to leave up on a projector. Every tool stays
 * mounted while you switch tabs, so a running timer keeps running.
 */
export default function ToolsApp(_props: AppProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('timer')
  const { names } = useNames()
  // A new list starts each name-based tool over, since positions in the old list no longer mean anything.
  const listKey = names.join('\u0000')
  const needsNames = TABS.find((t) => t.id === tab)?.needsNames ?? false

  return (
    <div className="quiz-app tools-app">
      <div className="tabs quiz-tabs" role="tablist" aria-label="Tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tools-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tools-panel-${t.id}`}
            className={tab === t.id ? 'tab tab-on' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="quiz-body">
        <div className="split">
          {needsNames && <NamesPanel />}
          <section className="pane tools-pane">
            <div
              role="tabpanel"
              id="tools-panel-timer"
              aria-labelledby="tools-tab-timer"
              hidden={tab !== 'timer'}
            >
              <TimerTool />
            </div>
            <div
              role="tabpanel"
              id="tools-panel-picker"
              aria-labelledby="tools-tab-picker"
              hidden={tab !== 'picker'}
            >
              <PickerTool key={listKey} names={names} />
            </div>
            <div
              role="tabpanel"
              id="tools-panel-groups"
              aria-labelledby="tools-tab-groups"
              hidden={tab !== 'groups'}
            >
              <GroupsTool key={listKey} names={names} />
            </div>
            <div
              role="tabpanel"
              id="tools-panel-seating"
              aria-labelledby="tools-tab-seating"
              hidden={tab !== 'seating'}
            >
              <SeatingTool key={listKey} names={names} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
