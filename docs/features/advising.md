# Advising

Developer notes for this app. The project-wide rules are in [`CLAUDE.md`](../../CLAUDE.md).

`src/main/repos/advising.ts` and the `advising.*` API. An advisee is a student tagged `advisee`: one record
serves the class and advising roles, and the tag is the only thing that decides who is listed
(`advisees()`, `openActions()`). Removing the tag keeps the history. Everything cascades from the student;
deleting a meeting or goal leaves its follow-ups, unlinked. A follow-up may only point at a meeting or goal
of the same student. Dates are `YYYY-MM-DD` text; "today" is `localToday()` in `src/shared/advising.ts`
(also holds the overdue rule and the copy-ready meeting summary). The app (`apps/advising/`) handles the
`open-advisee` intent and offers "Open in Gradebook" (`open-student`); meeting mode autosaves with a
debounce and flushes on leaving. Grades earned elsewhere are entered by hand or imported from a spreadsheet
(`src/shared/progressImport.ts`, `src/main/progressService.ts`, `advising.previewProgressImport` /
`commitProgressImport`): one row is one grade, matched to advisees only (email, then name), and a row
whose student, course, term and source match a stored entry updates it, so a re-import changes nothing.
The preview and the commit share one planner, and the commit re-plans from the file.
Word export of one meeting is `src/main/meetingDoc.ts` (house style in the comment at the top; pure,
returns a buffer) behind `meetingService.exportWord` and `advising.exportMeetingWord`, which asks for the
path through an injected `pickSaveFile`. It writes the meeting's own follow-ups only. The saved file is an
ordinary file with the student's name in it: nothing keeps it inside the Vault, and the app says so.
