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

## Presentation mode

Apps with `presentationSafe: false` are hidden while presenting. Shared components that show student
names or grades must render through the masking helpers so they blank out automatically.

## Commands

`npm run dev`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
Run lint, typecheck and tests before every commit.

## Style

Prettier (no semicolons, single quotes, 100 cols). Match surrounding code; keep comments for the
non-obvious "why".
