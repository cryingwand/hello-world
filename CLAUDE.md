# Teaching OS: conventions for Claude Code

Read `TEACHING_OS_PLAN.md` first. It is the approved scope, including the Vault and Stage amendment at
the end. Do not build features from later phases.

## Stack

Electron + React + TypeScript via `electron-vite`. SQLite through `better-sqlite3` in the main process.
Output is CommonJS (no `"type": "module"`) so the sandboxed preload script works.

## Layout

```
src/main/        Electron main process: DB, IPC, vault, stage, file guard, macOS integration, backups
  vault/         Passcode, lock lifecycle (manager), unlock rules (gate), legacy single-DB import
  mac/           Spotlight, open-and-snap, launcher snap (all take injected dependencies)
src/preload/     contextBridge that exposes `window.api`, built from the caller's role
src/shared/      Types and pure logic used by both sides (IPC contract, access map, grade math, stage)
src/renderer/src/
  shell/         Top bar, dock, window manager (launcher and vault windows)
  vault/         Lock screen, first-run passcode, vault settings
  stage/         The projector window
  apps/<id>/     One folder per app module (manifest.ts + component)
  components/    Shared UI
tests/           Vitest suites (main/, renderer/, shared/)
```

Path aliases: `@shared/*`, `@renderer/*`, `@apps/*`.

## Three windows, three roles

Sensitive data is kept out of reach instead of hidden. Every window has one role, recorded by the main
process from the window's own `webContents` id (nothing the renderer says about itself is trusted):

| Role       | Shows                                                    | Can reach                                           |
| ---------- | -------------------------------------------------------- | --------------------------------------------------- |
| `launcher` | Files (library) and the Presenter                        | Public data: settings, non-protected files, backups |
| `vault`    | Classes & Rosters, Gradebook, Advising, Files, Protected | Everything, only while the vault is unlocked        |
| `stage`    | What is being presented                                  | One method: `stage.view()`                          |

Each role has its own storage partition (`persist:teachingos-<role>`), its own `window.api` (the preload
exposes only the methods the role may call) and its own `tos-file://` handler. Main refuses a call from
anywhere but a window's top frame, so an iframe can never use the API.

### The access map

`src/shared/access.ts` holds `API_ACCESS`, which classifies every method of `ApiContract` (TypeScript
fails to compile until a new method is classified). `registerIpc` enforces it on every call, deny by
default. `needsVault` methods are also refused while the vault is locked or a presentation is running.
Default a new method to `VAULT`; make it `EVERYDAY` only if it is safe to call from the launcher.

### Change events

Main broadcasts change events through `CHANGE_AUDIENCE` (`src/shared/events.ts`): vault data events go to
vault windows only. Give every new event an audience.

## App module contract

Every app lives in `src/renderer/src/apps/<id>/` and exports a manifest from `manifest.ts`:

```ts
{ id, name, space: 'launcher' | 'vault', icon, component, defaultSize, handles: Intent[] }
```

`space` decides which window hosts the app. Anything that touches students, classes, grades or protected
files belongs in `vault`. The registry is per space, and intents are routed within a space. Apps are
in-process React modules, not iframes, and talk to data only through `window.api.*`.

## The Vault

- `data.sqlite` holds settings and the protected folder list. `vault.sqlite` (in `vault/`) holds terms,
  classes, students, enrollments, categories, assignments, scores, file links and the advising tables
  (`advising_meetings`, `goals`, `action_items`, `external_progress`). **A new table goes in
  the vault** unless there is a deliberate decision that it is safe to show anywhere.
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
- Vault backups are taken even while it is locked, from main.
- Fields holding student PII are tagged `sensitive` in `src/shared/sensitive.ts`. Nothing sends them
  anywhere; the tag is the seam for a future `src/main/ai/` service.

## Advising

`src/main/repos/advising.ts` and the `advising.*` API. An advisee is a student tagged `advisee`: one record
serves the class and advising roles, and the tag is the only thing that decides who is listed
(`advisees()`, `openActions()`). Removing the tag keeps the history. Everything cascades from the student;
deleting a meeting or goal leaves its follow-ups, unlinked. A follow-up may only point at a meeting or goal
of the same student. Dates are `YYYY-MM-DD` text; "today" is `localToday()` in `src/shared/advising.ts`
(also holds the overdue rule and the copy-ready meeting summary). The app (`apps/advising/`) handles the
`open-advisee` intent and offers "Open in Gradebook" (`open-student`); meeting mode autosaves with a
debounce and flushes on leaving. Grades earned elsewhere are manual entry only; there is no import yet.

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

## The Stage

`src/main/stage.ts` owns presenting. `start()` locks the vault first, then opens a frameless window on
the other display (or this one). The Presenter (launcher app) builds a queue of non-protected PDFs, images,
Word and text files; the Stage gets each as `tos-file://stage/<index>` or as content prepared in main, and
never sees a path. Keys (`]` `[` `B` `Esc`, arrows and space except inside a PDF) are handled in main
through `before-input-event`, so they work while a PDF has focus. The menu accelerator (Cmd/Ctrl+Shift+P)
starts and ends it. System notifications go through `createNotifier` (`src/main/notifier.ts`), never
`new Notification`, so they are held while the Stage is showing. Slides and spreadsheets are opened in
their own app from Files; the Stage does not show them.

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

PDFs and images reach a window through the `tos-file://` scheme (`resolveServedPath` allows only existing
PDFs and images, and each role adds its own policy). The renderer's CSP blocks `fetch()` to it on purpose.

## Commands

`npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
Run lint, typecheck and tests before every commit.

## Style

Prettier (no semicolons, single quotes, 100 cols). Match surrounding code; keep comments for the
non-obvious "why".
