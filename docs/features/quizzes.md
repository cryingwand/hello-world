# Quizzes & Exams

Developer notes for this app. The project-wide rules are in [`CLAUDE.md`](../../CLAUDE.md).

`src/main/repos/questions.ts`, `quizzes.ts` and the `questions.*` / `quizzes.*` API, all `VAULT`: exams are
what the vault exists to protect. A question has a kind (`multiple-choice`, `true-false`, `short-answer`,
`essay`); the repository normalises its shape (true/false always has the choices True, False; the open
kinds have none) so the stored row never disagrees with its kind. `quiz_items.question_id` is `RESTRICT`,
so a question in a quiz cannot be deleted (the repository checks first for a readable message). Points
come from the question unless the quiz item overrides them (`QuizEntry.points` is the effective value;
total with `sumPoints`, never a raw float sum). The Gradebook link is the assignment's own
`source_app = 'quiz-builder'` and `source_id = String(quizId)` (`QUIZ_SOURCE_APP`), so there is no column
and no sync job: one assignment per class, listed by `grading.assignmentsFromSource`. Deleting a quiz
clears that link and keeps the assignment and its scores. Word export is `src/main/quizDoc.ts` (house
style in the comment at the top; pure, returns a buffer) behind `quizService.exportWord`, which asks for
the path through an injected `pickSaveFile`. Ruled answer lines are tab leaders: adjacent paragraphs with
identical borders merge into one line in Word. The exported file is an ordinary file: nothing stops it
being saved outside a protected folder, and the app says so. Shared pure helpers (header text, dates,
parts, points) are in `src/shared/quiz.ts`. Form B (`src/shared/quizForms.ts`, `quizForForm`) shuffles the
questions within each part and the choices of each multiple-choice question; the seed comes from the quiz
id and its question ids, so Form B's student copy and key always agree and a re-export is identical until
the quiz changes. "All of the above" style choices stay last, a question whose choices point at each other
by letter is left in order, and True/False never moves. Form A is the quiz as built, labelled; no form is
the plain export. The form letter goes in the title: "Quiz 3 (Form B Answer Key)". The question and quiz fields are not tagged `sensitive`
(they are not student PII).
