# Teaching OS

A desktop-style teaching suite for one teacher on one Mac: a full-screen shell with a top bar, dock and
movable windows, where apps (Classes & Rosters, Files, Gradebook, and later Advising, Quiz Builder and
so on) share a single local SQLite database. Student data never leaves the machine.

Scope and phasing live in [`TEACHING_OS_PLAN.md`](./TEACHING_OS_PLAN.md).

## Requirements

- macOS with admin rights (the app is built unsigned for local use)
- Node.js 22 or newer
- Xcode Command Line Tools (`xcode-select --install`)

## Run it

```sh
npm install
npm run dev        # launches the shell with hot reload
npm test           # Vitest suites
npm run lint       # ESLint
npm run typecheck  # main/preload and renderer
npm run build      # typecheck, bundle, and produce an unsigned .app in release/
```

`npm run build` writes `release/mac-arm64/Teaching OS.app` (or `mac/` on Intel). Drag it to
`/Applications`. Because it is unsigned, the first launch needs right-click, then Open.

## Where things live

| Path                                                   | What                                          |
| ------------------------------------------------------ | --------------------------------------------- |
| `~/Library/Application Support/TeachingOS/data.sqlite` | The database                                  |
| `~/Library/Application Support/TeachingOS/backups/`    | Automatic backups (launch and daily, 14 days) |

## Permissions

Snapping Preview, TextEdit and Office windows beside the launcher uses System Events, so macOS will ask
for **Accessibility** (and **Automation** for System Events) the first time. Grant them under
System Settings, Privacy & Security.

## Layout

See [`CLAUDE.md`](./CLAUDE.md) for the architecture, the app module contract and conventions.
