/**
 * Columns that hold student PII. This is the seam for a future `src/main/ai/` service: anything
 * sent to an AI must have these stripped first. Phase 1 only tags them; nothing consumes the list
 * yet beyond a test that keeps it in sync with the schema.
 */
export const SENSITIVE_COLUMNS: Record<string, readonly string[]> = {
  students: ['first_name', 'last_name', 'preferred_name', 'email', 'notes', 'tags'],
  scores: ['comment'],
  file_links: ['path'],
  advising_meetings: ['topic', 'notes', 'summary'],
  goals: ['title', 'details'],
  action_items: ['title'],
  external_progress: ['course', 'term', 'grade', 'source']
}

/**
 * The only columns the everyday database may hold about students: the names-only roster copy. The
 * names are tagged sensitive above because the Vault holds them, but copying them out is a deliberate
 * decision (the people in a class can see who is in it). Email, notes, tags and everything about grades
 * stay in the Vault, and a test fails if this list grows or a table outside it appears.
 */
export const PUBLIC_ROSTER_COLUMNS: Record<string, readonly string[]> = {
  roster_classes: [
    'class_id',
    'course',
    'section',
    'period',
    'term_name',
    'current_term',
    'position'
  ],
  roster_members: [
    'class_id',
    'student_id',
    'first_name',
    'last_name',
    'preferred_name',
    'position'
  ]
}
