# Start using Teaching OS

Teaching OS is ready for everyday use on your Mac. These steps take about 15 minutes the first time.

## 1. Install it

You need, once:

- **Node.js 22 or newer** from [nodejs.org](https://nodejs.org) (the LTS installer). Check in Terminal with
  `node -v`.
- **Xcode Command Line Tools**: run `xcode-select --install` in Terminal.

Then, in Terminal:

```sh
git clone https://github.com/cryingwand/hello-world.git teaching-os
cd teaching-os
npm run install:mac
```

That builds the app, installs it as `/Applications/Teaching OS.app` and opens it. On the very first launch
macOS may ask whether to open an app from an unidentified developer: right-click the app in Applications,
choose **Open**, then **Open** again.

To **update** later: `cd teaching-os && git pull && npm run install:mac`. Your data is not inside the app,
so an update never touches it.

## 2. Try it with fake data first (optional)

Practice without touching anything real. This runs a separate copy whose data lives in a folder you can
delete afterwards:

```sh
TEACHING_OS_DATA_DIR=~/teaching-os-trial npm run dev
```

The `samples/` folder has a fake roster and a fake gradebook to import. Delete `~/teaching-os-trial` when
you are done.

## 3. Set it up

1. Click **Teaching OS** in the top bar to open Settings. Add your teaching folders (they come first in
   search). If you add an extra backup folder, use a USB drive or a folder that is **not** synced to the
   cloud.
2. Click **Vault** in the dock and choose a passcode. This is the space for classes, grades, advising,
   quizzes and lesson plans. It is there to keep student information off the projector: it locks when a
   display connects, when you start the Stage, when the Mac sleeps or the screen locks, and after 10
   idle minutes.
3. In the Vault, open **Protected Files** and add the folders that hold exams and answer keys. Their files
   then appear only inside the Vault, and anything you export from the Vault is saved there by default.

## 4. Bring in what you keep in Excel now

- **Rosters**: in the Vault, open **Classes & Rosters**, make a term (tick "current") and a class, then
  **Import roster** and pick your spreadsheet. You choose which columns hold the names and email, and see
  a preview before anything is saved.
- **Grades**: open **Gradebook**, choose the class, then **Import scores**. Each assignment column becomes
  an assignment. Put the points possible in the header (`Quiz 1 (20)`) or in a row under the headers, or
  type them in the import screen. `M` means missing and `EX` excused. Total and average columns are skipped.
  The class needs its students first (import the roster before the grades).
- **Attendance** has no place in Teaching OS yet. Keep it in Excel for now.

Re-importing the same file changes nothing, so you can keep your spreadsheet for a while and import it
again after you update it.

## 5. If something goes wrong

- **You deleted something by mistake**: in the Vault, open Settings (click **Teaching OS** in the top bar),
  scroll to **Restore the Vault** and pick the backup from just before. A backup is taken automatically
  before every delete and import. Restoring also backs up the Vault as it is now, so a restore can be
  undone too.
- **You forgot the passcode**: see "Forgot the passcode?" in the [README](../README.md).
- **Something looks broken**: note what you clicked and what you saw, and take a screenshot. Then ask
  Claude Code to fix it, in a session on this repository.

Once you have used it for a week or so, work through [`MAC_CHECKLIST.md`](./MAC_CHECKLIST.md). It covers
the Mac-only parts that automated tests cannot reach.
