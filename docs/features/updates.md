# Updates and previews

Developer notes for updating the app from inside it. The project-wide rules are in
[`CLAUDE.md`](../../CLAUDE.md).

**Where builds come from.** CI publishes every push to GitHub releases (`.github/workflows/ci.yml`, the
`mac` and `publish` jobs). A push to `master` becomes release `build-<run number>`, the newest version. A
push to any other branch replaces that branch's prerelease, `preview-<branch slug>` (`previewTag` in
`src/shared/build.ts`; CI makes the slug the same way), and `previews.yml` deletes it when the branch's
pull request closes or the branch is deleted. Nothing is published unless the tests and both smoke tests
(the built app and the packaged one) pass. The zip is the packaged `.app`, ad-hoc signed and made with
`ditto`. Builds are arm64 only; an Intel Mac would need an x64 runner added to the matrix.

**Stamping.** The `mac` job sets `TOS_BUILD_NUMBER`, `TOS_COMMIT`, `TOS_BRANCH` and `TOS_CHANNEL`
(`stable` or `preview`) before building, and `electron.vite.config.ts` bakes them into main as
`__TOS_BUILD__` (`src/main/buildInfo.ts`). Anything else (`npm run dev`, `npm run install:mac`, tests) is
`local`, numbered 0, so every published build is newer than it. A preview is packaged as a separate app,
**Teaching OS Preview** (`-c.productName`, `-c.appId=local.teachingos.preview`).

**The release body** is written by `scripts/release-notes.mjs`: one `- ` line per commit (since the last
`build-*` tag for a stable build, or not yet on master for a preview), then a marker line,
`<!-- tos-build {...} -->`, with the build's number, channel, branch and each zip's name, SHA-256 and
size by processor (`process.arch`). `parseReleases` in `src/shared/updates.ts` reads only releases that
carry a well-formed marker, so a release made by hand is ignored.

**In the app** (`src/main/update/updater.ts`, behind `updates.*`, all `LAUNCHER`, event
`updates.changed` to the launcher only):

- It asks `api.github.com` for the releases 15 seconds after launch and every 6 hours, never while the
  Stage is showing, and not at all in a run with its own `TEACHING_OS_DATA_DIR` (tests, trials). This is
  the app's only outbound network request, and it sends nothing about the teacher. It goes through
  `net.fetch` (so the Mac's proxy settings apply) and only to GitHub hosts (`isUpdateHost`), checked
  again after redirects.
- **Update and restart**: the zip is downloaded to `<data>/updates/` and checked against the published
  SHA-256, both databases are backed up (`backups.runAll`; a Vault backup failure refuses the update),
  `ditto` unpacks it beside the app in `/Applications` and `codesign --verify` checks it, then the old app
  is renamed aside (`.tos-old-<time>.app`) and the new one renamed into its place, and the app relaunches.
  What an install leaves behind is removed at the next launch (`cleanUp`). Data lives outside the app, so
  an update never touches it; newer migrations run when the new version opens the databases.
- Only the app in `/Applications` replaces itself (`cannotInstall`): a development run or a copy elsewhere
  only checks.
- **Try this version**: installs a preview as `/Applications/Teaching OS Preview.app` and opens it, with a
  fresh copy of the data in `~/Library/Application Support/TeachingOS Preview`. The copy is made from
  checked backups taken at that moment (the public and Vault databases, plus `vault.json`, so the same
  passcode opens it); backups are not copied. `preview.json` there records when. The Preview must be quit
  first (`pgrep -f` on its path: macOS cuts a process name to 16 characters). **Refresh its copy of my
  data** makes a new copy; **Remove the Preview** moves the app to the Trash and deletes its data.

**The Preview app** (`IS_PREVIEW`): it uses its own data folder, shows "Preview of <branch>" in the top
bar (`PreviewBadge`, from `system.info().build`), never copies backups to the extra backup folder its
copied settings name, and offers only newer builds of its own branch. Every API method that changes the
Mac's own files or calendar is marked `changesMac` in `src/shared/access.ts` (`EVERYDAY_MAC_WRITE`), and
`registerIpc`'s `beforeCall` refuses it in the Preview: its data is a copy, but the files and calendar are
the real ones. `access.test.ts` lists them; a new method that writes to the Mac must be marked. Exports
through a save dialog are allowed (a new file the teacher chose).

The smoke test covers Settings' Updates section, and with `SMOKE_EXPECT_PREVIEW=1` (CI sets it for a
preview build) checks the badge and that moving a file and adding a calendar event are refused.
