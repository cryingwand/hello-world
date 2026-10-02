# Teaching OS: conventions for Claude Code

Read `TEACHING_OS_PLAN.md` first. It is the approved scope, including the Vault and Stage amendment at
the end. Do not build features from later phases.

## Stack

Electron + React + TypeScript via `electron-vite`. SQLite through `better-sqlite3` in the main process.
Output is CommonJS (no `"type": "module"`) so the sandboxed preload script works.

## Layout

```
src/main/        Electron main process: DB, IPC, vault, stage, file guard, folders, desk, macOS integration, backups
  vault/         Passcode, lock lifecycle (manager), unlock rules (gate), legacy single-DB import
  mac/           Spotlight, open-and-snap, launcher snap, Calendar (all take injected dependencies)
src/preload/     contextBridge that exposes `window.api`, built from the caller's role
src/shared/      Types and pure logic used by both sides (IPC contract, access map, grade math, stage)
src/renderer/src/
  shell/         Top bar, dock, canvas desktop and window manager (launcher and vault windows)
  vault/         Lock screen, first-run passcode, vault settings
  stage/         The projector window
  apps/<id>/     One folder per app module (manifest.ts + component)
  components/    Shared UI
tests/           Vitest suites (main/, renderer/, shared/)
scripts/         Smoke test, Mac install, samples, session start
docs/            START_HERE (install), MAC_CHECKLIST (manual checks), features/ (per-app notes)
```

Path aliases: `@shared/*`, `@renderer/*`, `@apps/*`.

## Three windows, three roles

Sensitive data is kept out of reach instead of hidden. Every window has one role, recorded by the main
process from the window's own `webContents` id (nothing the renderer says about itself is trusted):

| Role       | Shows                                                            | Can reach                                                                       |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `launcher` | Files, Calendar, the Presenter, In-class Tools, the desktop      | Public data: settings, non-protected files, backups, the names-only roster copy |
| `vault`    | Classes, Gradebook, Advising, Quizzes, Planner, Files, Protected | Everything, only while the vault is unlocked                                    |
| `stage`    | What is being presented                                          | One method: `stage.view()`                                                      |

Each role has its own storage partition (`persist:teachingos-<role>`), its own `window.api` (the preload
exposes only the methods the role may call) and its own `tos-file://` handler. Main refuses a call from
anywhere but a window's top frame, so an iframe can never use the API.

### The access map

`src/shared/access.ts` holds `API_ACCESS`, which classifies every method of `ApiContract` (TypeScript
fails to compile until a new method is classified). `registerIpc` enforces it on every call, deny by
default. `needsVault` methods are also refused while the vault is locked or a presentation is running.
Default a new method to `VAULT`; make it `EVERYDAY` only if it is safe to call from the launcher. A Vault
method that deletes or overwrites data (`delete*`, `commit*` imports, `unenroll`) is `VAULT_DESTRUCTIVE`:
`registerIpc`'s `beforeCall` takes a Vault backup first (at most one a minute, `snapshotVault`) and refuses the
call if it cannot. `access.test.ts` fails if a `delete*`/`commit*` method is not marked.

### Change events

Main broadcasts change events through `CHANGE_AUDIENCE` (`src/shared/events.ts`): vault data events go to
vault windows only. Give every new event an audience.

## The canvas desktop

Each window's desktop is an endless canvas (`src/renderer/src/shell/`). A free window's `x`/`y` are canvas
coordinates and the camera (`WmState.camera`: the canvas point at the desktop's top-left, and a zoom
between `MIN_ZOOM` and `MAX_ZOOM`) decides where it is drawn; `placement()` turns one into the other, and a
zoomed window is the same layout box scaled with a CSS transform, so apps never see the zoom. Maximized
and snapped windows are pinned to the screen and ignore the camera. All of it is pure reducer logic in
`windowManager.ts` (tested in `tests/renderer/windowManager.test.ts`); pointer code divides screen
distances by the zoom. New windows open beside the others and the camera pans to them (`reveal`).
`.desktop` uses `overflow: clip` so a focused field or `scrollIntoView` inside a window can never scroll the
canvas. Anything an app shows with `position: fixed` must be portaled to `<body>` (as `Modal` and
`ContextMenu` are), since a scaled window would otherwise contain it. React still passes a portal's events
up to the desktop, so the desktop acts on a pointer event only when its target is really inside it on the
page (`inDesktop` in `Desktop.tsx`); a canvas handler that forgets this swallows dialog clicks. In the
everyday window the canvas also holds the teacher's own arrangement (`DeskLayer`: pinned files and folders,
labelled areas), which Fit and the map include through `ShellContext.canvasExtras`.

## The Mac as the backend

Teaching OS works on the Mac's own data rather than copies: files and folders (`folders.*`, the Files app's
Browse tab and the desktop) and the calendar (`calendar.*`, through EventKit). Notes:
[`docs/features/files-and-desktop.md`](docs/features/files-and-desktop.md) and
[`docs/features/calendar.md`](docs/features/calendar.md). The rules that matter everywhere: changes to files
are made only inside the home folder, never to a protected file or a folder that holds one, never over an
existing file, and a delete is always a move to the Trash (`shell.trashItem`). A new way to change files
must go through `createFolders` or follow the same rules.

## App module contract

Every app lives in `src/renderer/src/apps/<id>/` and exports a manifest from `manifest.ts`:

```ts
{ id, name, space: 'launcher' | 'vault', icon, component, defaultSize, handles: Intent[] }
```

`space` decides which window hosts the app. Anything that touches students, classes, grades or protected
files belongs in `vault`. The registry is per space, and intents are routed within a space. Apps are
in-process React modules, not iframes, and talk to data only through `window.api.*`.

## The Vault

- `data.sqlite` holds settings, the protected folder list, a names-only copy of the class rosters (see
  below) and the everyday desktop's arrangement (`desk_items`, see
  [`docs/features/files-and-desktop.md`](docs/features/files-and-desktop.md)). `vault.sqlite` (in `vault/`) holds terms,
  classes, students, enrollments, categories, assignments, scores, file links and the advising tables
  (`advising_meetings`, `goals`, `action_items`, `external_progress`) and the quiz tables (`questions`,
  `quizzes`, `quiz_items`) and the planner tables (`units`, `lessons`, `lesson_quizzes`, `lesson_blocks`,
  `lesson_tasks`). **A new table goes in
  the vault** unless there is a deliberate decision that it is safe to show anywhere.
- **The public roster copy** is a deliberate exception to "student data stays in the vault": `roster_classes`
  and `roster_members` (public migration 2) hold each class's label and its students' names, so the
  launcher can use a roster (In-class Tools) while the Vault is locked or a presentation is running. The
  decision is that names are fine to show in the everyday window (the class can see who is in it). Nothing
  else may go there: the columns are an allowlist (`PUBLIC_ROSTER_COLUMNS` in `src/shared/sensitive.ts`, and
  a test fails if one is added), and email, notes, tags (the `advisee` tag shows who you advise), grades and
  advising never leave the vault. A student in no class is not copied at all, and only classes still being
  taught are: the current term's and those of terms whose end date has not passed (`rosterSnapshot`), so past
  students' names do not stay outside the Vault. The Vault stays the only place
  a roster is edited; `src/main/rosterMirror.ts` rewrites the copy from it, straight away on the vault's
  `students`/`classes`/`enrollments`/`terms` change events (they only fire while it is open, so there is
  never a closed database to write to) and once on every unlock, which also builds the first copy after an
  upgrade. The mirror must never throw (it runs while the vault opens and after the teacher's own saves),
  logs no names, and `directoryRepo.replace` is the only writer: the window API is read-only
  (`directory.classes` / `directory.students`, launcher only, no vault needed, nothing for the vault or
  stage windows) and a change is announced as `directory.changed` to the launcher only. A new place that
  changes a student's name or class must emit one of those events.
- Migrations are versioned and append-only, separately for each database (`PUBLIC_MIGRATIONS`,
  `VAULT_MIGRATIONS`). Never edit a shipped migration; add a new one.
- The vault is a lifecycle (`src/main/vault/manager.ts`). Locked means the connection is closed, every
  vault window is destroyed, and nothing built on the database exists. It locks on: manual lock, idle
  timeout, screen lock, sleep, a display connecting, and the start of a presentation.
- `vault.json` holds the scrypt passcode hash, the Touch ID flag, the idle setting and the failed-attempt
  counter (persisted, so restarting does not reset the wait). The passcode gates access through the app;
  it does not encrypt `vault.sqlite`. FileVault protects the disk.
- Unlock goes through `createVaultGate`: refused while presenting (checked again after the passcode is
  verified), and confirmed with a native dialog when another display is connected.
- Vault backups are taken even while it is locked, from main. Every backup is checked (`quick_check`)
  before it is renamed into place. Retention (`backupsToKeep` in `src/main/backup.ts`): everything from the
  last 14 days, then the newest of each week for 16 weeks and of each month for a year.
- Restore (`src/main/vault/restore.ts`, `vault.backups` / `vault.restore`, Vault Settings): a backup is chosen
  by name, never by path, copied aside and checked, the Vault as it is now is backed up, and then
  `manager.replaceDatabase` locks the Vault and swaps the file (removing any stale `-wal`). The next unlock
  runs newer migrations on it.
- Fields holding student PII are tagged `sensitive` in `src/shared/sensitive.ts`. Nothing sends them
  anywhere; the tag is the seam for a future `src/main/ai/` service.

## App notes

Each app's design decisions live beside the conventions, not in this file. **Read the note before changing
that app**, and update it in the same commit:

- Advising: [`docs/features/advising.md`](docs/features/advising.md)
- Quizzes & Exams: [`docs/features/quizzes.md`](docs/features/quizzes.md)
- Lesson & Unit Planner (with the lesson builder and to-do list): [`docs/features/planner.md`](docs/features/planner.md)
- In-class Tools: [`docs/features/in-class-tools.md`](docs/features/in-class-tools.md)
- Files, folders and the everyday desktop: [`docs/features/files-and-desktop.md`](docs/features/files-and-desktop.md)
- Calendar: [`docs/features/calendar.md`](docs/features/calendar.md)

Write a new note in `docs/features/` for a new app, and link it here.

## Protected folders

Folders the teacher marks protected (exams, quizzes, answer keys) are listed in the public database so
they apply while the vault is locked, but only the unlocked vault can read or change the list
(`protection.*`; `settings.get()` never returns it). `src/main/protected.ts` decides whether a path is
inside one: it compares real locations (symlinks, `..`), ignores case and Unicode form on macOS, matches
whole path segments, and treats a path it cannot examine as protected. Every file entry point goes through
the window's `FileGuard`: search drops protected files before ranking, `info`/`readText`/`docxHtml`/
`table`/`thumbnail`/`pickFile` refuse them, `open` and `reveal` also refuse while another display is
connected, and the `tos-file://` handlers refuse them. Only an unlocked vault window may see them. A new
way to read a file path must call the guard.

Every save dialog for a file exported from the Vault goes through `createSafeSave` (`src/main/safeSave.ts`,
wired in `createSession` in `src/main/index.ts`): it opens in a protected folder and asks before saving
outside one. A new Vault export must use it.

## The Stage

`src/main/stage.ts` owns presenting. `start()` locks the vault first, then opens a frameless window on
the other display (or this one). The Presenter (launcher app) builds a queue of non-protected PDFs, images,
Word and text files; the Stage gets each as `tos-file://stage/<index>` or as content prepared in main, and
never sees a path. Keys (`]` `[` `B` `Esc`, arrows and space except inside a PDF) are handled in main
through `before-input-event`, so they work while a PDF has focus. The menu accelerator (Cmd/Ctrl+Shift+P)
starts and ends it. System notifications go through `createNotifier` (`src/main/notifier.ts`), never
`new Notification`, so they are held while the Stage is showing. Slides and spreadsheets are opened in
their own app from Files; the Stage does not show them. The In-class Tools can also put a timer in the corner
and a picked name or groups in place of the file (`stage.setTimer` / `stage.showTool`, only while it is
showing, cleared when it ends); see [`docs/features/in-class-tools.md`](docs/features/in-class-tools.md).
Playwright's own key presses skip `before-input-event`, so the smoke test presses Stage keys with
`webContents.sendInputEvent`.

## Adding to the data API

1. Declare the method in `ApiContract` and list its name in `API_METHODS` (`src/shared/api.ts`).
2. Classify it in `API_ACCESS` (`src/shared/access.ts`).
3. Implement it in a repository (`src/main/repos/`) or service and wire it in `src/main/api.ts`.
4. Validate input with `src/main/validate.ts`; throw `ValidationError` for anything the user should see.
   Any other error is logged and shown as a generic message.
5. Emit the matching change event from the repository after the write commits, and give it an audience.
6. Add tests in `tests/main/`. `api.test.ts` and `access.test.ts` fail if the contract, method list,
   access map and wiring disagree.

`window.api.<namespace>.<method>()` is generated from `API_METHODS`; there is no per-method preload
code. Every renderer call is async. Use `useApiQuery(fetcher, deps, events)` so views refetch when
another window changes the data. The renderer never sees a file path it did not get from the main
process, and main validates every payload.

`TEACHING_OS_DATA_DIR` overrides the data folder (databases, backups, renderer storage). Use it for any
automated run so tests never touch real data.

## Grades

Grade rules live in one place, `src/shared/grades.ts`, with the rules written at the top of the file:
missing counts as zero, excused and ungraded are left out, late is only a flag, weighted mode rescales
over categories that have graded work. The grid, student view and exports all call it; do not
reimplement it. `src/shared/scoreImport.ts` holds the score import planner and export layout.

## macOS integration (`src/main/mac/`)

All of it takes injected dependencies (`exec`, `stat`, `isMac`, `isTrusted`, the launcher window) so it can
be unit-tested off a Mac. Programs are run with `execFile`, never a shell. For automated runs on a
non-Mac machine these environment variables stand in for the real thing:

- `TEACHING_OS_FORCE_MAC=1` treats the machine as macOS for gating.
- `TEACHING_OS_BIN_MDFIND`, `TEACHING_OS_BIN_OPEN`, `TEACHING_OS_BIN_OSASCRIPT` replace those executables.
- `scripts/fake-osascript.mjs` (as `TEACHING_OS_BIN_OSASCRIPT`) answers the Calendar script from the JSON
  file named by `TOS_FAKE_CALENDAR`. The smoke test uses it, and a pretend `HOME`, on every platform.

PDFs and images reach a window through the `tos-file://` scheme (`resolveServedPath` allows only existing
PDFs and images, and each role adds its own policy). The renderer's CSP blocks `fetch()` to it on purpose.

## Commands

`npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

- `npm run check` runs format, lint, typecheck and tests. Run it before every commit.
- `npm run smoke` builds and launches the real app with a throwaway data folder and drives it with
  Playwright (`scripts/smoke.mjs`): every app opens, the Vault opens, a backup restores. Run it after any
  change to the main process, the preload, IPC, the shell or an app's first render. In a Linux container:
  `npx electron-vite build && xvfb-run -a node scripts/smoke.mjs` (`node node_modules/electron/install.js`
  first if Electron's binary is missing). Extend it when you add an app or a flow.
- CI (`.github/workflows/ci.yml`) runs `check` and the smoke test on Linux, and the tests, the smoke test,
  the packaged `.app` and a smoke test of that package on macOS. The Mac job is the only place the Mac
  code paths and native packaging run for real; a failure there is never "only CI".
- `npm run install:mac` builds and installs the app in `/Applications` (the teacher's install and update
  path, `docs/START_HERE.md`).
- What only a person can check (Spotlight, snapping, Touch ID, displays, sleep, Calendar) is in
  `docs/MAC_CHECKLIST.md`. Add a line there when a change needs one.
- Cloud sessions install dependencies at start (`scripts/session-start.sh`, `.claude/settings.json`).

## Design language: Carrel

Colour, type, spacing, motion and layers are tokens in `src/renderer/src/carrel.css`, loaded before
`styles.css`. The rules that are not in the CSS (the seven states, the Vault's identity, the Stage, block
glyphs) and the migration order are in [`docs/design/carrel-handoff.md`](docs/design/carrel-handoff.md);
**read it before changing how anything looks**. `main.tsx` sets `data-space` (`everyday`, `vault`, `stage`)
and `data-theme` on `<html>` from `window.api.role`. Do not define colours in `styles.css` or a component:
use a token. Do not build what the handoff lists under "Ask first".

## Style

Prettier (no semicolons, single quotes, 100 cols). Match surrounding code; keep comments for the
non-obvious "why".
