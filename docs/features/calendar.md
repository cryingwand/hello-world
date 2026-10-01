# Calendar

Developer notes. The project-wide rules are in [`CLAUDE.md`](../../CLAUDE.md).

The Mac's calendars (every account added to Calendar: iCloud, Exchange, Google) through EventKit. The
teacher chose to have the calendar in the everyday window, knowing event titles can name students; the
app is `space: 'launcher'` and the API is `EVERYDAY` so the Vault's planner can add lessons.

`src/main/mac/calendar.ts` runs a fixed JavaScript for Automation script with `osascript -l JavaScript`.
The script uses the ObjC bridge to EventKit, which expands repeating events into their dates (scripting
the Calendar app does not). The command and its data are separate arguments (`run(argv)`, one JSON
argument), so nothing the teacher types is ever part of the script; a test checks it. Every call checks
access first: status 0 asks (macOS shows its own prompt, naming Teaching OS, and the script runs the run
loop until it is answered, up to two minutes), 3 is full access, and anything else (including 4,
write-only) is "denied" with a message saying where to allow it. The packaged app declares
`NSCalendarsUsageDescription` and `NSCalendarsFullAccessUsageDescription` (`electron-builder.yml`); without
them macOS refuses without asking, which is why it only works in the installed app, not `npm run dev`.

Calls: `status`, `calendars` (id, title, colour, account, writable), `events(from, to)` (at most 62 days,
sorted), `create`, `delete(id, start)`. A repeating event's occurrences share EventKit's identifier, so
delete removes the one occurrence that starts at `start` (`EKSpanThisEvent`). Nothing is cached in main;
`calendar.changed` follows a change made here, and the app also refetches every three minutes for changes
made in Calendar.

The app (`apps/calendar/`) is a week (Monday first) with an all-day row, side-by-side overlaps
(`layoutDay` in `src/shared/calendar.ts`), a line at the current time, calendars to show or hide (kept in
the window's storage) and an event panel with Delete. `EventForm` is shared with the Lesson Planner's
**Add to Calendar** (needs a lesson date; the title is "course: lesson", the length the class length, and
the agenda goes in the event's notes; it is a one-off, not kept in step with the lesson).

Automated runs use `scripts/fake-osascript.mjs` (`TEACHING_OS_BIN_OSASCRIPT`, with
`TEACHING_OS_FORCE_MAC=1` off a Mac): it answers the script's commands from the JSON file named by
`TOS_FAKE_CALENDAR`. The real EventKit path runs only on a Mac; see `docs/MAC_CHECKLIST.md`.
