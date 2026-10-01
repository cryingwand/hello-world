# Files, folders and the everyday desktop

Developer notes. The project-wide rules are in [`CLAUDE.md`](../../CLAUDE.md).

The Mac's own files are the backend: nothing is copied into Teaching OS. Three pieces.

**Folders** (`src/main/folders.ts`, API `folders.*`, `EVERYDAY`). One instance per window role, each with
that role's `FileGuard`. `places()` is home, Desktop, Documents, Downloads, iCloud Drive and the teaching
folders that exist. `list(dir)` returns one folder, folders first, without dot files; outside the open
Vault, protected entries are left out (strong check, `snapshot().has`) and listing a protected folder is
refused, as everywhere else. Anything on the disk can be listed (search already reaches the whole Mac), but
changes (`createFolder`, `rename`, `move`, `trash`) are refused unless:

- the path, resolved through symlinks, is inside the home folder and not in `~/Library`;
- it is not one of the fixed folders directly in home (Desktop, Documents, Downloads, …);
- it is not protected, and a folder being moved, renamed or trashed holds no protected folder
  (`ProtectedSnapshot.encloses`): moving the folder would carry the protected one away from the path the
  protection list names. This holds in the Vault window too;
- nothing already has the new name: nothing is ever replaced.

A move or trash of several items checks all of them before changing any. Trash is Electron's
`shell.trashItem` (the Mac's Trash, so it can be put back); nothing is ever deleted outright. A move across
disks (`EXDEV`) is refused rather than copied. After a change `folders.changed` is broadcast (no path in
it), and the last 16 folders listed are watched with `fs.watch` so a change made in Finder shows up too.
A rename or move also calls `moved(from, to)`, which repoints desktop pins (`deskRepo.repath`).

**The Files app** (`apps/files/`): a Browse tab (`FolderBrowser.tsx`) beside Search, in both windows.
Click a file to preview it on the right, double-click a folder to go in, ⌘-click to pick several, drag
onto a folder row (or ↑) to move, right-click for the rest. Rows drag as `application/x-tos-paths`
(`PATHS_TYPE`, a JSON list of `{ path, isDir }`) to a folder or the desktop. The `open-path` intent
(launcher only, handled by Files) shows a folder, or a file in its folder.

**The everyday desktop** (`src/main/deskService.ts`, `repos/desk.ts`, API `desk.*`, `LAUNCHER`). Public
migration 3, `desk_items`: a file or folder pinned to the canvas (a path) or a labelled area, with its
canvas rect. This is in the public database by decision: the launcher can already see these files, a pin of
a protected file is refused, and a pin whose folder becomes protected later is left out of `items()`. A
pin is a pointer: `remove` never touches the file, and a pin whose file is gone is shown as missing.
`arrange` saves several moves at once (an area dragged with what is on it) and only lets an area change
its label and colour, or an area or folder its size. Drawn by `shell/DeskLayer.tsx` in one layer under the
windows, transformed by the camera; Fit and the map include it through `ShellContext.canvasExtras`. A folder
card lists its folder live and takes files dropped on it (a move). Double-click opens a file in Files when
there is a built-in viewer, otherwise in its own app. The Vault's canvas has no desk.

The desktop handles pointer events only when they really happen inside it on the page: React passes
events from a portal (a dialog, a menu) up the component tree, and treating those as canvas clicks once
swallowed every dialog button over the canvas. The smoke test clicks dialog buttons for real to catch that.
