# Teaching OS: conventions for Claude Code

Read `TEACHING_OS_PLAN.md` first. It is the approved scope. Do not build features from later phases.

## Stack

Electron + React + TypeScript via `electron-vite`. SQLite through `better-sqlite3` in the main process.
Output is CommonJS (no `"type": "module"`) so the sandboxed preload script works.

## Layout

```
src/main/        Electron main process: DB, IPC handlers, macOS integration (src/main/mac/), backups
src/preload/     contextBridge that exposes the typed `window.api`
src/shared/      Types and pure logic used by both sides (IPC contract, grade math, intents, events)
src/renderer/src/
  shell/         Top bar, dock, window manager, presentation mode
  apps/<id>/     One folder per app module (manifest.ts + component)
  components/    Shared UI (must honour presentation masking)
tests/           Vitest suites (main/, renderer/, shared/)
```

Path aliases: `@shared/*`, `@renderer/*`, `@apps/*`.

## App module contract

Every app lives in `src/renderer/src/apps/<id>/` and exports a manifest from `manifest.ts`:

```ts
{ id, name, icon, component, defaultSize, handles: Intent[], presentationSafe: boolean }
```

The shell registry reads the manifests; the dock and launcher are built from them. Apps are in-process
React modules, not iframes. Apps talk to data only through `window.api.*`, never to SQLite directly.

## Cross-app communication

- Shared DB plus a change-event bus. Main broadcasts `students.changed`, `scores.changed`, and so on;
  every window subscribes with `useChangeEvent` and refetches.
- Intents (`open-student`, `open-class`, `attach-file`, `record-score`) go through the shell, which
  opens the record in whichever app lists that intent in `handles`.

## Data rules

- Migrations are versioned and append-only. Never edit a shipped migration; add a new one.
- Fields holding student PII are tagged `sensitive` in the schema. Nothing sends them anywhere in
  Phase 1; the tag is the seam for a future `src/main/ai/` service.
- The renderer never sees a file path it did not get from the main process, and main validates every
  IPC payload.

## Adding to the data API

1. Declare the method in `ApiContract` and list its name in `API_METHODS` (`src/shared/api.ts`).
2. Implement it in a repository (`src/main/repos/`) and wire it in `src/main/api.ts`.
3. Validate input in the repository with `src/main/validate.ts`; throw `ValidationError` for anything
   the user should see. Any other error is logged and shown as a generic message.
4. Emit the matching change event from the repository after the write commits.
5. Add a test in `tests/main/`. `api.test.ts` fails if the contract, method list and wiring disagree.

`window.api.<namespace>.<method>()` is generated from `API_METHODS`; there is no per-method preload
code. Every renderer call is async. Use `useApiQuery(fetcher, deps, events)` in components so views
refetch when another window changes the data.

`TEACHING_OS_DATA_DIR` overrides the data folder (database, backups, renderer storage). Use it for
any automated run so tests never touch real data.

## macOS integration (`src/main/mac/`)

All of it takes injected dependencies (`exec`, `stat`, `isMac`, `isTrusted`, the launcher window) so it can
be unit-tested off a Mac. Programs are run with `execFile`, never a shell. For automated runs on a
non-Mac machine these environment variables stand in for the real thing:

- `TEACHING_OS_FORCE_MAC=1` treats the machine as macOS for gating.
- `TEACHING_OS_BIN_MDFIND`, `TEACHING_OS_BIN_OPEN`, `TEACHING_OS_BIN_OSASCRIPT` replace those executables.

PDFs and images reach the renderer through the `tos-file://` scheme (`resolveServedPath` allows only
existing PDFs and images). The renderer's CSP blocks `fetch()` to it on purpose.

## Presentation mode

Apps with `presentationSafe: false` are hidden while presenting. Shared components that show student
names or grades must render through the masking helpers so they blank out automatically.

## Commands

`npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
Run lint, typecheck and tests before every commit.

## Style

Prettier (no semicolons, single quotes, 100 cols). Match surrounding code; keep comments for the
non-obvious "why".
