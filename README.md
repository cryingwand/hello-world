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

## Try the importer

`samples/` holds fake files (invented names, `example.org` emails); regenerate them with
`node scripts/make-samples.mjs`.

- `sample-roster.xlsx`: in Classes & Rosters, choose Import roster, pick it, check the column mapping,
  preview, and import.
- `sample-gradebook-export.xlsx`: a school-system style score export for the same students. In Gradebook,
  choose Import scores. Points possible come from the headers (`Quiz 1 (20)`), `M` means missing and `EX`
  excused, and the Total and Current Grade columns are skipped automatically.

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
