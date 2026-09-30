# Teaching OS

A desktop-style teaching suite for one teacher on one Mac: a full-screen shell with a top bar, dock and
movable windows, where apps (Classes & Rosters, Files, Gradebook, and later Advising, Quiz Builder and
so on) share a single local SQLite database. Student data never leaves the machine.

Scope and phasing live in [`TEACHING_OS_PLAN.md`](./TEACHING_OS_PLAN.md).

## What is in Phase 1

- **Shell**: top bar (clock, file search, current-class picker, presentation toggle), a dock, and movable,
  resizable, snappable windows whose layout is restored on relaunch.
- **Classes & Rosters**: terms, classes and students; Excel/CSV roster import with column mapping and a
  preview; roster export.
- **Files**: Spotlight search with your teaching folders ranked first; built-in viewers for PDF, images,
  text and Markdown (editable), Word and Excel (read-only); open in Preview, TextEdit, Word, Excel or
  PowerPoint and snap the app beside the launcher; attach files to a class or student.
- **Gradebook**: per-class weighted or total-points grading, a keyboard score grid with missing, excused
  and late flags, averages, a per-student view, and Excel/CSV import and export of scores.
- **Presentation mode**: hides the Gradebook and masks student names and grades. Toggle it in the top bar,
  from View, Presentation Mode, or with Cmd+Shift+P. It also offers itself when an external display connects.
- **Backups**: a SQLite backup at launch and daily, the last 14 days kept, optionally copied to a second folder.

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

`npm run build` writes `release/mac-arm64/Teaching OS.app` (or `mac/` on Intel). If macOS refuses to open
it, or says it is damaged, ad-hoc sign it once:

```sh
sh scripts/adhoc-sign.sh
```

Then drag it to `/Applications` and, on the first launch, right-click it and choose Open.

## First-run setup

1. Click **Teaching OS** in the top bar to open Settings. Add your teaching folders (search lists their
   files first) and, if you like, an extra folder that also receives every backup.
2. The first time you snap a window beside the launcher, macOS asks for **Accessibility** and
   **Automation** access. Allow them under System Settings, Privacy & Security.

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
