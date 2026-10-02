# Mac checklist

These are the parts of Teaching OS that only a person on a Mac can check: Spotlight, window snapping,
Touch ID, displays and sleep. Everything else is covered by the automated tests and the smoke test (see
`CLAUDE.md`, Commands). Tick each box after you have tried it. If something fails, write down what you
expected, what happened, and what you did just before, and give that to Claude Code.

Use your real setup (the installed app, your own folders) but it is fine to use a fake class.

## The canvas desktop

- [ ] Two-finger scroll on empty canvas moves around it; inside a window it scrolls the window.
- [ ] Pinch on the trackpad zooms the canvas around the pointer, and the page itself does not zoom.
- [ ] Dragging empty canvas moves it; dragging a title bar moves the window, at any zoom.
- [ ] Zoomed out to about 50%, text in a window is still readable and clicks land where you point.
- [ ] Open a PDF in Files while zoomed out. It shows, and scrolls, inside the window.

## Your files and folders

- [ ] Files, **Browse**: Desktop, Documents and Downloads open (macOS may ask to allow access to each;
      allow it).
- [ ] Make a folder, rename a file, drag a file onto a folder. Finder shows the same.
- [ ] Rename a file in Finder. Teaching OS shows the new name within a second or two.
- [ ] **Move to Trash** puts the file in the Mac's Trash, and **Put Back** in Finder restores it.
- [ ] A protected folder does not appear in Browse, and its parent folder cannot be renamed or moved.
- [ ] Drag a file and a folder from Browse onto the desktop. Quick Look previews show on the file card,
      and the folder card lists what is in it.
- [ ] Right-click the desktop, **New area here**, name it, put pins on it and drag the area: they move
      with it. Quit and reopen: the arrangement is as you left it.

## Calendar

- [ ] In the **installed** app, open Calendar. macOS asks for access to your calendars; allow full access.
- [ ] This week's events show, including a repeating class on each of its days, and all-day events.
- [ ] Add an event; it appears in Apple Calendar (and on your phone). Delete it; it goes from both.
- [ ] Delete one occurrence of a repeating event: only that day's goes.
- [ ] In the Lesson Planner, **Add to Calendar…** on a dated lesson adds it with the agenda in its notes.

## Files and search

- [ ] Search for a file name you know. Results in your teaching folders come first.
- [ ] Turn on **Teaching folders only**. Files elsewhere disappear.
- [ ] Preview a PDF, an image, a `.docx` and an `.xlsx` inside Files.
- [ ] **Open in Preview** on a PDF. Preview opens and snaps to the right half, with Teaching OS on the
      left. (The first time, macOS asks for Accessibility and Automation access. Allow both, then try
      again.)
- [ ] The same with a Word file in Word and a spreadsheet in Excel.
- [ ] **Restore full screen** puts the Teaching OS window back to full size.

## The Vault

- [ ] Lock the Vault with **Lock**. Its window closes.
- [ ] Open it with your passcode, then with Touch ID if you turned it on.
- [ ] Enter a wrong passcode five times. It asks you to wait, and quitting and reopening the app does not
      reset the wait.
- [ ] Leave the Vault open and lock the screen (Ctrl+Cmd+Q). When you come back, the Vault is locked.
- [ ] The same after closing the lid (sleep).
- [ ] Set **Lock when idle** to 2 minutes and leave it alone. It locks.

## Displays and the Stage

- [ ] With the Vault open, plug in the projector (or a second screen) as an **extended** display. The
      Vault locks straight away, and the Presenter offers the Stage.
- [ ] Opening the Vault while the projector is connected asks you first.
- [ ] In the Presenter, queue a PDF, an image and a Word file, then **Start**. They show on the
      projector, not on your laptop.
- [ ] `]` and `[` move between files, `B` blanks the screen, the arrow keys page through a PDF, `Esc`
      ends the Stage.
- [ ] While the Stage is showing, the Vault will not open, and notifications do not pop up.
- [ ] Try to queue a file from a protected folder. It is refused.
- [ ] Cmd+Shift+P starts and ends the Stage.

## Exports and protected folders

- [ ] Export a gradebook to Excel from the Gradebook. The save dialog opens in a protected folder.
- [ ] Choose your Desktop instead. It warns you first. Choose **Save here anyway** and the file is saved.
- [ ] Export a quiz answer key and a lesson deck, and open each in Word and PowerPoint. Both look right
      (Palatino, the header line, the lists).

## Backups

- [ ] Settings shows a recent backup. **Back up now** adds one.
- [ ] In the Vault, delete a test student, then restore the backup from just before (Settings, Restore
      the Vault). The Vault closes; reopen it and the student is back.
- [ ] Quit and reopen the app. Your windows, data and settings are as you left them.

## Lesson builder

- [ ] Drag a block from the panel into the middle of a lesson, and drag a block to a new place.
- [ ] Each block's prep shows in the To-do tab; ticking it there ticks it in the lesson.

## In-class Tools

- [ ] **Load a class** fills the picker with the names of a class in the current term.
- [ ] Start a 1-minute timer, switch to the picker tab and back. The timer kept running, and it beeps at
      zero.
- [ ] With the Stage showing on the projector, **Show on the Stage** in the Timer tab puts the timer in
      the corner, over a PDF. Start, pause and add a minute: the projector follows straight away, and the
      timer stays while you move to the next file.
- [ ] Tick **Show each pick on the Stage** and pick someone: only the chosen name appears on the
      projector, large.
- [ ] Make groups for a real-sized class and **Show on the Stage**: every name is readable from the back
      of the room and nothing is cut off. Esc goes back to the file; Esc again ends the Stage.

## Updates and previews

- [ ] Settings, **Updates**, **Check now** finds the newest version (or says this is the newest). **Update
      and restart** reopens the app on the new build number, with your windows, data and Vault passcode as
      they were.
- [ ] **Try this version** on a version in progress opens **Teaching OS Preview** beside the real app, with
      "Preview of …" in its top bar. Your classes and lessons are there; a change you make in it does not
      appear in the real app.
- [ ] In the Preview, dragging a file onto a folder and adding a calendar event are refused.
- [ ] **Refresh its copy of my data** asks you to quit the Preview first if it is open. **Remove the
      Preview** puts it in the Trash.
