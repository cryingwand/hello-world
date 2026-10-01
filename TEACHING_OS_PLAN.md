# Teaching Launcher: Scope and Phase 1 Handoff

## Context

Tyler (a teacher) has several teaching apps built with Claude Code, in mixed stacks (single HTML files, React/Vite projects, Python scripts). The goal is to replace them with one suite that runs on the work Mac: a full-screen, desktop-style environment where the apps share one data store and work together. It must still reach the Mac's own tools: Finder/Spotlight search, Preview, TextEdit, and Word/Excel/PowerPoint.

Decision: **start fresh** in one unified codebase. The old apps are reference material only. Tyler will share their files so their features can be rebuilt as modules of the suite.

This file defines the scope and the Phase 1 build for the next session.

## Decisions made (from the scoping Q&A)

| Topic | Decision |
|---|---|
| Machine | Tyler's own Mac with admin rights, so unsigned self-built apps are fine |
| Build setup | New GitHub repo (placeholder name `teaching-os`). Claude Code runs **on the Mac** so the macOS features can be tested for real. |
| Look and feel | **Full desktop**: top bar, dock, movable/resizable app windows |
| Preview/TextEdit | **Both**: quick view/edit inside, plus "Open in Preview/TextEdit" that launches the real app and snaps it beside the launcher |
| Office | Open in real Word/Excel/PowerPoint (snap beside), **import** from Office files, **export** to Office files. No in-app Office editing. |
| File search | Spotlight across the whole Mac, **teaching folders ranked first**, with a "teaching only" toggle |
| Storage | **Local only** on the work Mac (one SQLite file) with automatic backups. Student data never leaves the machine. |
| Shared data | Classes/rosters, grades/results, lessons/content, question bank. All four are shared across apps. |
| Rosters/grades I/O | Excel import/export, CSV import/export, manual entry. No LMS/SIS API integration. |
| Audience | Tyler only, sometimes projected, so a **presentation mode** is needed that hides student data and grades |
| Grading | **Varies by class**: each class is set to weighted categories or total points |
| Advisees | **Separate group** from class students. Their grades come from elsewhere (manual or Excel/CSV import). |
| AI | Not in early builds. Leave a clean seam to add Claude later, with student PII kept out of anything sent to the AI. |
| Name | Decide later (placeholder "Teaching OS") |
| Phase 1 | Shell + foundation + **Gradebook** as the first real app |

## Suite contents (full scope)

1. **Desktop shell**: top bar (clock, global search, current-class picker, presentation toggle), dock, window manager, app registry
2. **Classes & Rosters** (system app): classes, sections, terms, students, enrollments
3. **Files**: Spotlight search, quick viewers, handoff to native apps with window snapping
4. **Gradebook**: *Phase 1*
5. **Advising**: advisee profiles, meeting mode, goals/follow-ups, meeting summaries
6. **Quiz & Exam Builder**: question bank, Word export in house style, creates Gradebook assignments
7. **Lesson & Unit Planner**: units/lessons, attached files, linked quizzes, PowerPoint export
8. **In-class Tools**: random picker, timer, group maker, seating chart (presentation-safe)
9. **Rebuilt legacy apps**: from files Tyler shares, each fitted to the module contract

## Architecture (recommended)

- **Electron + React + TypeScript**, scaffolded with `electron-vite`. Electron gives full Node access for `mdfind`, `open -a`, and AppleScript window control. It is also the most mature option for Claude Code to build and debug.
- **One codebase with in-process app modules.** Each app is a module, not an iframe or separate process, so all apps share typed data access and UI components.
- **Data**: SQLite via `better-sqlite3` in the main process, with versioned migrations. The renderer reaches it through a typed IPC API (`window.api.*`). DB location: `~/Library/Application Support/TeachingOS/data.sqlite`.
- **Cross-app communication**:
  - A shared DB plus a **change-event bus**. The main process broadcasts `students.changed`, `scores.changed` and similar events, and every open window refreshes.
  - **Intents**: `open-student`, `open-class`, `attach-file`, `record-score`. Any app can ask the shell to open a record in whichever app handles it (e.g. a student name in Advising opens their Gradebook row).
  - **Drag and drop** of files and records between windows.
- **App module contract** (`src/apps/<id>/manifest.ts`): `{ id, name, icon, component, defaultSize, handles: Intent[], presentationSafe: boolean }` (amended: `space` replaces `presentationSafe`, see the Vault and Stage amendment). The shell's registry reads the manifests, and the dock and launcher are built from them.
- **macOS integration** (main process, `src/main/mac/`):
  - Search: `mdfind` (Spotlight), plus `mdfind -onlyin <folder>` for teaching folders. Results in teaching folders rank first.
  - Thumbnails: `nativeImage.createThumbnailFromPath` (uses Quick Look).
  - Open in a native app: `open -a "Preview" <file>`, and the same for TextEdit, Microsoft Word, Excel and PowerPoint.
  - Snap beside: JXA/AppleScript via `osascript` to set the frontmost window's position and size in System Events. The launcher window takes the left half and the native app the right half. Needs the Accessibility permission, which the app requests on first use.
- **Built-in viewers**:
  - PDF and images: Chromium's built-in PDF viewer, `<img>`
  - Text: `.txt` and `.md` editing in CodeMirror. `.rtf` goes to TextEdit.
  - `.docx`: read-only preview via `mammoth` (docx to HTML)
  - `.xlsx` and `.csv`: read-only table via `SheetJS`
  - `.pptx`: Quick Look thumbnail plus an "Open in PowerPoint" button
- **Office I/O libraries**:
  - `exceljs`: read/write xlsx, used for rosters and gradebooks
  - `docx`: Word export in the house style (Palatino Linotype 12pt; centered Course, Title, Date header)
  - `pptxgenjs`: PowerPoint export
  - `mammoth`: Word import
  - `papaparse`: CSV
- **Presentation mode** (superseded by the Stage, see the amendment at the end): a top-bar toggle plus a hotkey. It also offers to turn on automatically when an external display connects (Electron `screen` events). While on, it hides or blurs every window whose manifest is not `presentationSafe`, masks student names and grades in shared components, and suppresses notifications.
- **Backups**: SQLite online backup on launch and daily to `~/Library/Application Support/TeachingOS/backups/`, keeping 14 days, with an optional extra folder Tyler chooses.
- **AI seam (not built)**: fields are tagged `sensitive` in the schema. A future `src/main/ai/` service would strip sensitive fields before any call. Nothing is implemented in Phase 1 beyond the tag.

### Shared data model (Phase 1 creates everything the Gradebook and Rosters need; later tables are added by later phases)

- **Phase 1**:
  - `students` (first, last, preferred, email, notes, tags; the `advisee` tag lets one record serve both roles)
  - `terms`, `classes` (course, section, period, term, `grading_mode`: `weighted` | `points`)
  - `enrollments`
  - `grade_categories` (class, name, weight)
  - `assignments` (class, category, title, points_possible, due_date, source_app, source_id)
  - `scores` (assignment, student, points, status: missing/excused/late, comment)
  - `file_links` (path, record_type, record_id): attach Mac files to any record
  - `settings` (teaching folders, backup folder, presentation defaults)
- **Later phases**: `advising_meetings`, `goals`, `action_items`, `external_progress` (for advisees: course, term, grade, source); `questions`, `quizzes`, `quiz_items`; `units`, `lessons`.

## Phase 1: next session's build

1. **Scaffold** the repo: electron-vite React TypeScript, ESLint + Prettier, Vitest, `electron-builder` config for a local unsigned `.app`, README with run instructions, and a `CLAUDE.md` describing the module contract and conventions.
2. **Shell**:
   - Top bar and dock
   - Window manager: open, focus, move, resize, minimize, maximize, snap-left/right
   - Window layout restored on relaunch
   - App registry built from the manifests
3. **Data layer**: SQLite, migrations, typed repositories, IPC API, change-event broadcast, backups.
4. **Classes & Rosters** app:
   - CRUD for terms, classes and students
   - Excel/CSV roster import with a column-mapping step and a preview before commit
   - Roster export
5. **Files** app plus top-bar search:
   - Spotlight search, teaching folders first
   - Thumbnails and the built-in viewers
   - Open in Preview, TextEdit or Office and snap beside
   - Attach a file to a class or student
6. **Gradebook** app:
   - Per-class setup of grading mode (weighted or points) and categories
   - Assignments and a score-entry grid with keyboard navigation
   - Missing/excused/late flags
   - Per-student and class averages that follow the class's grading mode
   - Per-student detail view, which the `open-student` intent opens
   - Excel/CSV import and export of scores
7. **Presentation mode**: working end to end. Gradebook is not presentation-safe and is hidden or masked.

**Out of Phase 1**: Advising, Quiz Builder, Lesson Planner, In-class Tools, legacy-app rebuilds, AI. Each gets its own later session, in roughly this order: Advising, Quiz & Exam Builder, Lesson Planner, In-class Tools, then the legacy rebuilds.

## Tyler's prep before the next session

- Install Node.js LTS and Xcode Command Line Tools (`xcode-select --install`), which `better-sqlite3` needs to build. Also install Claude Code on the Mac (desktop app or CLI).
- Create the new GitHub repo, or let the session create it.
- Put the old apps' files in one folder, e.g. `~/TeachingOS-legacy/`, for reference in later phases.
- Have a **fake or anonymized** sample Excel roster and a gradebook export from your school system, to test the importers.
- List your teaching folders (e.g. `~/Documents/Courses`) for "teaching first" search ranking.

## Verification (Phase 1)

- `npm run dev` launches the desktop shell. `npm test` passes the Vitest suites:
  - Grade calculation for both grading modes, including missing/excused handling
  - Roster and score import/export round-trips through xlsx and csv
  - Migrations run on an empty DB
- Manual checklist on the Mac:
  1. Import the sample Excel roster into a new class, and check that the students appear in Rosters and Gradebook without a reload
  2. Set up weighted categories, enter scores, and check the averages by hand
  3. Export the gradebook to .xlsx and open it in Excel through "Open in Excel"; Excel snaps to the right half
  4. Search a known file name: teaching-folder results come first, and opening one in Preview snaps it beside the launcher
  5. Preview a .docx and an .xlsx inside the Files app
  6. Turn on presentation mode: the Gradebook and student names are hidden or masked
  7. Quit and relaunch: windows, data and settings persist, and a backup file exists
- `npm run build` produces a `.app` that launches from /Applications.

## Kickoff prompt for the next session

Paste this into Claude Code on the Mac, inside the new empty repo folder, with this file copied into that folder:

> Read `TEACHING_OS_PLAN.md`. It is the approved scope for a teaching suite I want to run as a desktop-style environment on this Mac. Build **Phase 1** exactly as described: scaffold, shell, data layer, Classes & Rosters, Files (Spotlight search, built-in viewers, open-and-snap Preview/TextEdit/Office), Gradebook, presentation mode and backups. Work through it in order, and commit after each numbered step. My teaching folders are: `<list them here>`. A fake sample roster is at `<path>` and a sample gradebook export is at `<path>`. When you finish, run the verification checklist and tell me which items need me to check by hand.

## Amendment: Vault and Stage

Requested after Phase 1 shipped: "make the presentation mode a presentation tool so there isn't an opening
for sensitive information to get through, and put the gradebook and anything else that should be protected
in a dedicated space, including exams, quizzes and other things I wouldn't want to leak."

Phase 1's presentation mode was a mask: one window, one database, and about fifty places that had to
remember to hide student data. A missed tooltip or input value leaked. It is replaced by isolation.

Decisions:

| Topic | Decision |
|---|---|
| Presenting | A separate **Stage** window on the other display, able to call one method. The Presenter app queues PDFs, images, Word and text files. Slides and spreadsheets open in their own app. |
| Protected space | A **Vault** window holding Classes & Rosters, Gradebook, Files with attachments and Protected Files. Its data is in a separate `vault.sqlite`. |
| Lock | Passcode gate (scrypt, persisted backoff), optional Touch ID, idle lock, screen-lock and sleep lock. No custom encryption; FileVault covers the disk. |
| Exams and quizzes | Protected folders the teacher chooses. Their files are hidden from search and refused by every preview, picker and handler outside the Vault, whether or not it is locked. |
| Display connected | The Vault locks immediately and the Stage is offered. Unlock asks first while another display is connected. Starting the Stage always locks the Vault, and the Vault will not open until it ends. |
| Module contract | `presentationSafe` is replaced by `space: 'launcher' | 'vault'`. |
| Future modules | New tables (Quiz Builder, Advising) default to the vault database. |

Implementation followed five stages, one commit each: roles and an access map; vault storage and gate;
protected folders; Stage and Presenter; removal of the masks and this documentation.

Known limits, documented in the README: no encryption at rest, no screenshot prevention, Word and Preview
keep their own Recent Files lists, hard links and Finder aliases are not seen by protected folders, and a
mirrored projector may not be detected as a second display.

## Phase 2: Advising

Phase 2 is the first item on the "later phases" list: **Advising**. Built as a vault app (everything in it is
about a student). Included: advisee profiles (students tagged `advisee`), goals, follow-ups with owner
(student or me), due dates and an overdue flag, a meeting history, meeting mode (previous summary, open
follow-ups, goals and outside grades beside this meeting's autosaved notes), a copy-ready summary, and
`external_progress` entered by hand. Tables `advising_meetings`, `goals`, `action_items` and
`external_progress` are vault migration 2. New intent: `open-advisee`.

Not built: Excel/CSV import of outside grades (still in the Phase 1 decisions table), Word export of a
meeting summary, and the other later phases (Quiz & Exam Builder, Lesson Planner, In-class Tools, legacy
rebuilds).

## Phase 3: Quiz & Exam Builder

Phase 3 is the next item on the "later phases" list: the **Quiz & Exam Builder**. Built as a vault app, since
exams are what the Vault protects. Included: a question bank (multiple choice, true/false, short answer,
essay; tags, search, a model answer), quizzes and exams assembled from it in order with per-quiz points, Word
export in the house style (a student copy and an answer key), and **Add to Gradebook**, which creates an
assignment in a class worth the quiz's total points. Tables `questions`, `quizzes` and `quiz_items` are vault
migration 3; the Gradebook link is the assignment's `source_app`/`source_id`. No new intent.

Not built: shuffled versions (A/B order), importing questions from a Word file, a link from a Gradebook
assignment back to its quiz, recording per-question results, and the other later phases (Lesson Planner,
In-class Tools, legacy rebuilds).
