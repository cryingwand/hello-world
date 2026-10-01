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

**The lesson builder** (vault migration 6). A lesson is built from `lesson_blocks`: a kind from
`BLOCK_KINDS` (`src/shared/lessonBlocks.ts`: lecture, discussion, writing, reading, group, activity, video,
assessment, presentation, review, break, other), a title (the kind's name by default), minutes (the kind's
usual length by default; null is allowed) and the teacher's own `details`, in `position` order. A kind is
stored as its id, so never rename one; an id the app does not know is shown as `other`. The repository
validates the kind (there is no CHECK, so a new kind needs no migration). `lessons.class_minutes` is how long
the class meets; the session roadmap measures the blocks against it (spare time striped, over time
outlined). `lessons.addBlock` takes an optional `position` (a drop between two blocks) and adds the kind's
`tasks` as `lesson_tasks` rows for the block, in the same transaction. Tasks are the to-do list: a task has
a `block_id` (null for one added by hand), text and `done`; deleting a block deletes its tasks (cascade),
done or not. `deleteBlock`/`deleteTask` are `VAULT_DESTRUCTIVE`. A copied lesson or unit copies its blocks
and tasks (each task re-pointed at the copied block) with every task not done, and the class length; a
moved lesson keeps them. `units.todo(includeDone)` lists open tasks soonest lesson first (undated last);
done ones only when asked, newest first, capped at `DONE_LIMIT`. A task is due on its lesson's date, and
`todoBucket` files it as overdue, today, next 7 days, later or no date (worked in UTC days). The deck adds
an Agenda slide per lesson from `agendaLine` (kind, title, minutes), before the Plan; a block's `details`
never go on a slide, like lesson notes.

**Semesters.** `units.term_id` (nullable, `ON DELETE SET NULL`) puts a unit in a term. `units.roadmap(termId
| null)` returns that term's units (or those with none) with their lessons, ordered by first lesson date.
Deleting a term clears it without a planner event, so the planner's unit and roadmap queries also refetch
on `terms.changed`. A copied unit starts with no semester (like its dates, a copy is for later). The
Semester tab defaults to the current term.

The UI is in `apps/planner/`: `LessonBuilder` (the panel and the session's blocks; HTML drag and drop with
the dragged thing kept in a ref, plus ↑/↓ buttons for the keyboard), `LessonTasks`, `RoadmapBar` (one
segment per block, `KindMix` for time by kind; kind colours are the `.kind-*` classes in `styles.css`),
`SemesterView` and `TodoView`. Block fields save as you type through `useAutosave`, like the lesson's.
