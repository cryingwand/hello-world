/** Records an app can ask the shell to open in whichever app handles them. */
export type RecordType = 'student' | 'class' | 'term'

export type Intent =
  | { type: 'open-student'; studentId: number; classId?: number }
  | { type: 'open-class'; classId: number }
  | { type: 'attach-file'; path: string; recordType: RecordType; recordId: number }
  | { type: 'record-score'; assignmentId: number; studentId: number }

export type IntentType = Intent['type']
