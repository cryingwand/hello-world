# Teaching OS

A desktop-style teaching suite for one teacher on one Mac: a full-screen shell with a top bar, dock and
movable windows, where apps (Classes & Rosters, Files, Gradebook, Advising, and later Quiz Builder and
so on) share local SQLite data. Student data never leaves the machine, and it is kept in a separate,
passcode-locked **Vault** so that nothing you present can reach it.

Scope and phasing live in [`TEACHING_OS_PLAN.md`](./TEACHING_OS_PLAN.md).

## What is in Phases 1 and 2

- **Two spaces**: the everyday window (Files and the Presenter) and the **Vault** window (Classes &
  Rosters, Gradebook, Advising, Files with attachments, Protected Files). They are separate windows with separate
  data; see [The Vault and the Stage](#the-vault-and-the-stage).
- **Shell**: top bar (clock, file search, current-class picker in the Vault, Present and Lock buttons), a
  dock, and movable, resizable, snappable windows whose layout is restored on relaunch.
- **Classes & Rosters**: terms, classes and students; Excel/CSV roster import with column mapping and a
  preview; roster export.
- **Files**: Spotlight search with your teaching folders ranked first; built-in viewers for PDF, images,
  text and Markdown (editable), Word and Excel (read-only); open in Preview, TextEdit, Word, Excel or
  PowerPoint and snap the app beside the launcher; attach files to a class or student.
- **Gradebook**: per-class weighted or total-points grading, a keyboard score grid with missing, excused
  and late flags, averages, a per-student view, and Excel/CSV import and export of scores.
- **Advising** (Phase 2): students tagged `advisee` get a profile with goals, follow-ups (yours or the
  student's, with due dates and an overdue flag), a meeting history and grades earned elsewhere (entered
  by hand). Start meeting opens meeting mode: last time's summary, what is still open and the goals beside
  this meeting's notes, saved as you type, with a copy-ready summary. It lives in the Vault.
- **Presenting**: a separate **Stage** window on the other display that can show only the files you queue in
  the Presenter. Start and end it with Present in the top bar, View, Presentation Mode, or Cmd+Shift+P.
- **Protected folders**: mark the folders that hold exams, quizzes and answer keys; their files appear only
  inside the Vault.
- **Backups**: a SQLite backup of both databases at launch and daily, the last 14 days kept, optionally
  copied to a second folder. The Vault is backed up even while it is locked.

## The Vault and the Stage

Hiding student data on screen is easy to get wrong, so nothing is hidden: it is kept somewhere the
presenting window cannot reach.

- **Vault**: students, classes, grades and file attachments live in their own database
  (`vault/vault.sqlite`). Open it from the Vault button in the dock and choose a passcode on first use
  (at least 6 characters; Touch ID can be added). While it is locked its database is closed and its
  windows are gone. It locks when you press Lock, after the idle time in its Settings (10 minutes by
  default), when the screen locks or the Mac sleeps, when a display is connected, and when you start the
  Stage. It will not open while the Stage is showing, and asks first if another display is connected.
- **Stage**: a full-screen window on the other display (or this screen if there is none) that can call
  exactly one thing: "what should I show?". In the Presenter, search for PDFs, images, Word and text
  files, click to queue them, then Start the Stage. Keys: `]` and `[` for next and previous, `B` to blank,
  `Esc` to end; arrows and space also move between files, except inside a PDF, where they page through
  it. Open slides and spreadsheets from Files in PowerPoint or Excel instead; the Stage does not show them.
- **Protected folders**: in the Vault, open Protected Files and choose the folders that hold exams,
  quizzes and answer keys. Outside the Vault those files are missing from search, refused by every preview
  and by the file picker, and cannot be queued on the Stage, whether or not the Vault is locked. Inside the
  Vault you can browse and preview them; opening one in Word or Preview is refused while another display is
  connected.

### What this does not do

- The passcode stops access through the app. It does not encrypt `vault.sqlite`, so someone who can read
  your files can read it. Turn on **FileVault** (System Settings, Privacy & Security) to protect the disk.
- It cannot stop a screenshot or screen recording, and it cannot clear the **Recent Files** lists that
  Word, Preview and TextEdit keep. That is why protected files are viewed inside the Vault first, and why
  opening one in another app is refused while a display is connected.
- Protected folders are matched by where a file really is, so symlinks and `..` do not get around them.
  Hard links and Finder aliases point at the same data without a path inside the folder, and are not seen.
- A mirrored projector can look like a single display, so "a display was connected" may not fire. Starting
  the Stage always locks the Vault, so start it before you put anything on the screen.

### Forgot the passcode?

There is no reset, and no backdoor. Your data is not encrypted, so nothing is lost: quit the app, delete
`~/Library/Application Support/TeachingOS/vault/vault.json`, and open the Vault again to choose a new
passcode. `vault.sqlite` is left alone and opens with the new one.

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
2. Open the **Vault** from the dock and choose a passcode. If you used an earlier version, your classes
   and grades are moved into the Vault the first time it opens (a copy of the old database is kept in
   `backups/`).
3. In the Vault, open **Protected Files** and add the folders that hold exams, quizzes and answer keys.
4. The first time you snap a window beside the launcher, macOS asks for **Accessibility** and
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

| Path                                                          | What                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `~/Library/Application Support/TeachingOS/data.sqlite`        | Settings and the protected folder list                   |
| `~/Library/Application Support/TeachingOS/vault/vault.sqlite` | Students, classes, grades, attachments                   |
| `~/Library/Application Support/TeachingOS/vault/vault.json`   | Passcode hash, Touch ID, idle time, failed attempts      |
| `~/Library/Application Support/TeachingOS/backups/`           | `data-` and `vault-` backups (launch and daily, 14 days) |

## Permissions

Snapping Preview, TextEdit and Office windows beside the launcher uses System Events, so macOS will ask
for **Accessibility** (and **Automation** for System Events) the first time. Grant them under
System Settings, Privacy & Security.

## Layout

See [`CLAUDE.md`](./CLAUDE.md) for the architecture, the app module contract and conventions.
