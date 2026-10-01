# In-class Tools

Developer notes for this app. The project-wide rules are in [`CLAUDE.md`](../../CLAUDE.md).

`apps/tools/` (launcher space) is a timer, a random picker, a group maker and a seating chart in one app with
four tabs. The names come from what the teacher types or pastes, or from "Load a class", which reads the
names-only roster copy (`directory.*`, the only part of the data API this app may call). Names are student
information in a window that may be on the projector, so they live in memory only (`namesStore.ts`): never
written to storage, never sent to main, gone when the app quits. A test
(`tests/renderer/toolsPrivacy.test.ts`) scans that folder for storage, network, console and any
`window.api` call other than `directory.classes` / `directory.students`, so adding one fails a test. All the rules are pure functions in `src/shared/tools.ts` with injected
randomness and time (`parseNames`, `pickNext`, `makeGroups`, `seatRandomly`/`swapSeats`/`resizeSeats`, and
the `timer*` functions): everyone goes once before anyone repeats and a new round never opens with the
person who just went; groups differ in size by at most one; resizing the seating grid keeps people where
they sit; the timer counts down from a clock (`endsAt`), not by subtracting ticks, so a busy or sleeping
screen cannot make it run slow. Every tool stays mounted while switching tabs so a running timer keeps
running. A seating chart is not saved: the roster copy is names only, and a saved layout would be a second
place for student data outside the Vault.
