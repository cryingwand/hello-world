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
