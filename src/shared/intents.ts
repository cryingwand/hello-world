/** Records an app can ask the shell to open in whichever app handles them. */
export type RecordType = 'student' | 'class' | 'term'

export type Intent =
  | { type: 'open-student'; studentId: number; classId?: number }
  | { type: 'open-class'; classId: number }
  | { type: 'open-advisee'; studentId: number }
  | { type: 'open-quiz'; quizId: number }
  | { type: 'open-gradebook'; classId: number }
  | { type: 'attach-file'; path: string; recordType: RecordType; recordId: number }
  | { type: 'record-score'; assignmentId: number; studentId: number; classId?: number }
  | { type: 'search-files'; query: string }
  /** Show a folder, or a file in its folder, in Files. The path came from the main process. */
  | { type: 'open-path'; path: string; isDir: boolean }

export type IntentType = Intent['type']
