# In-class Tools

Developer notes for this app. The project-wide rules are in [`CLAUDE.md`](../../CLAUDE.md).

`apps/tools/` (launcher space) is a timer, a random picker, a group maker and a seating chart in one app with
four tabs. The names come from what the teacher types or pastes, or from "Load a class", which reads the
names-only roster copy (`directory.*`, the only part of the data API this app may call). Names are student
information in a window that may be on the projector, so they live in memory only (`namesStore.ts`): never
written to storage, gone when the app quits, and sent to main only to be shown on the Stage (below). A test
(`tests/renderer/toolsPrivacy.test.ts`) scans that folder for storage, network, console and any
`window.api` call other than `directory.classes` / `directory.students` and the Stage calls in
`stageLink.ts`, which must be the only file making them, so adding one fails a test. All the rules are pure functions in `src/shared/tools.ts` with injected
randomness and time (`parseNames`, `pickNext`, `makeGroups`, `seatRandomly`/`swapSeats`/`resizeSeats`, and
the `timer*` functions): everyone goes once before anyone repeats and a new round never opens with the
person who just went; groups differ in size by at most one; resizing the seating grid keeps people where
they sit; the timer counts down from a clock (`endsAt`), not by subtracting ticks, so a busy or sleeping
screen cannot make it run slow. Every tool stays mounted while switching tabs so a running timer keeps
running. A seating chart is not saved: the roster copy is names only, and a saved layout would be a second
place for student data outside the Vault.

## On the Stage

The timer, the picked name and the groups can go on the projector (decided with the teacher; the seating
chart stays on the laptop). Everything goes through `stageLink.ts`, and only to a Stage that is already
showing: `stage.setTimer` and `stage.showTool` (launcher only) refuse otherwise, so names never wait in
main for a later start. Main checks what it is sent (`parseStageTool`, `parseStageTimer` in
`src/main/stage.ts`: non-empty names of at most `MAX_NAME_LENGTH`, no more than `MAX_NAMES` in all, a
running timer ending within a day), holds it in memory and drops it when the Stage ends.

- **The timer** floats in the top-right corner over whatever is showing, file or tool, and stays while
  moving between files. The tool pushes its `TimerState` on every change (start, pause, a minute more or
  less, reset); the Stage counts down from `endsAt` itself, so the two never drift. The Stage remounts its
  timer for each new state so the first reading of the clock is never stale.
- **The picker** sends only the drawn name, after the spin, and only while "Show each pick on the Stage"
  is ticked. Never the list or the spin.
- **Groups** go up with "Show on the Stage"; shuffling again while they are up sends the new groups.
  The Stage picks the column count (one to eight) that gives the largest text, so the longest name fits
  on one line and every group fits under the timer.

A tool replaces the file full screen. Esc, Next, Previous, a click on a queue item, or "Back to the file"
(in the tool or the Presenter) puts it away; a second Esc ends the Stage (the first, while blanked).
Blank hides the tool and the timer as well. The Presenter shows what is up and can take either off.
