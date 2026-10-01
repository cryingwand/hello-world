# Lesson & Unit Planner

Developer notes for this app. The project-wide rules are in [`CLAUDE.md`](../../CLAUDE.md).

`src/main/repos/planner.ts` (one repository, two API namespaces: `units.*` and `lessons.*`), all `VAULT`:
lessons link to exams and attach protected files, so the planner is vault data like the quizzes it points
at. A unit has a title, a free-text course (like a quiz's) and an overview; it has no dates of its own, so
its span is the earliest and latest lesson date (`UnitSummary.firstDate`/`lastDate`). A lesson belongs to
one unit and is ordered by `position` (`units.reorder` takes every lesson id once, `lessons.delete`
renumbers). Its text fields (`objectives`, `plan`, `homework`, `notes`) are one point per line; `notes` are
the teacher's and only ever become speaker notes. `lesson_quizzes` is many to many: deleting a quiz drops
the link and the quizzes repository then emits `planner.changed`; deleting a unit or lesson never touches a
quiz. Attached files use `file_links` with record types `unit` and `lesson` (migration 4 rebuilt the table,
since SQLite cannot change a CHECK); links are not foreign keys, so the planner clears them with the
record and emits `fileLinks.changed`. Add a record type to `TABLE` in `fileLinks.ts` and the migration's
CHECK together. `units.upcoming()` is dated lessons from `localToday()` on, capped at `UPCOMING_LIMIT`.
`units.duplicate` copies a unit with its lessons in order, the same quizzes linked (a quiz is shared, never
copied) and the same files attached, in one transaction; lesson dates are cleared unless the options keep
them or shift them by whole days (`CopyDates`, `copiedDate` in `src/shared/lesson.ts`, worked in UTC).
`lessons.duplicate` puts a copy right after the original and `lessons.move` appends a lesson to another
unit (its quizzes and files go with it, the old unit is renumbered). `useAutosave().flush()` returns a
promise that resolves when every save so far has landed: await it before any action that reads the saved
text (a copy), because it is otherwise fire-and-forget.

`lesson_classes` and `lesson_assignments` (vault migration 5) link a lesson to the classes it is taught to
and to the Gradebook assignments that go with it (`lessons.linkClass` / `linkAssignment` and the unlinks):
an assignment can only be linked once its class is, and unlinking a class drops that class's assignment
links. They are pointers only: both cascade from every side, deleting a lesson or unit never touches the
Gradebook, and the planner UI refetches on `classes.changed` and `assignments.changed` instead of the
Gradebook repositories emitting `planner.changed`. A copy of a lesson or unit starts with no class or
assignment links (they belong to one class's scores); a moved lesson keeps them. The `open-gradebook`
intent (handled by the Gradebook) opens a class there. The PowerPoint never mentions classes or assignments.

PowerPoint export is `src/main/lessonDeck.ts` (house style in the comment at the top; pure, returns a
buffer) behind `lessonService.exportPowerPoint`, which asks for the path through an injected
`pickSaveFile`, for a whole unit or one lesson. Only quiz titles are written, never questions or answers,
and a test enforces that. Long lists are split by `chunkBullets` (`src/shared/lesson.ts`) rather than
relying on shrink-to-fit, which PowerPoint only applies when a slide is edited. The saved file is an
ordinary file: nothing stops it being saved outside a protected folder, and the app says so. The app
(`apps/planner/`) saves lesson and unit fields as you type through `useAutosave` (debounced, on blur and
when the editor goes away; a refused save keeps the typing on screen, reports the error and is retried
with the next save) and opens a linked quiz with the
`open-quiz` intent, which Quizzes & Exams handles. The planner fields are not tagged `sensitive` (they are
not student PII).
