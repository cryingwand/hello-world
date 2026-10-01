import { useEffect, useState } from 'react'
import type { StageTool, StageToolKind } from '@shared/stage'
import type { TimerState } from '@shared/tools'

/**
 * The one place the In-class Tools talk to the Stage. Names go to main only when the teacher sends a
 * tool to a Stage that is already showing; main holds them in memory and drops them when the Stage
 * ends. Nothing here is stored.
 */
export interface StageLink {
  /** The Stage is showing, so a tool can be sent to it. */
  showing: boolean
  /** Which tool is on the Stage in place of the file, if any. */
  tool: StageToolKind | null
  /** The timer is in the corner of the Stage. */
  timer: boolean
}

const OFF: StageLink = { showing: false, tool: null, timer: false }

export function useStageLink(): StageLink {
  const [link, setLink] = useState<StageLink>(OFF)
  useEffect(() => {
    let live = true
    const apply = (s: { active: boolean; tool: StageToolKind | null; timer: boolean }): void => {
      if (live) setLink({ showing: s.active, tool: s.tool, timer: s.timer })
    }
    const off = window.api.onStageState(apply)
    window.api.stage.state().then(apply, () => undefined)
    return () => {
      live = false
      off()
    }
  }, [])
  return link
}

/** Shows a tool on the Stage in place of the file, or with null goes back to the file. */
export const showOnStage = (tool: StageTool | null): Promise<unknown> =>
  window.api.stage.showTool(tool)

/** Puts the timer in the corner of the Stage (call on every change), or with null takes it off. */
export const timerOnStage = (timer: TimerState | null): Promise<unknown> =>
  window.api.stage.setTimer(timer)
