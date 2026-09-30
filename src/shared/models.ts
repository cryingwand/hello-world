export type GradingMode = 'weighted' | 'points'
export type ScoreStatus = 'missing' | 'excused' | 'late'
export type LinkRecordType = 'student' | 'class' | 'term'

export interface Term {
  id: number
  name: string
  startDate: string | null
  endDate: string | null
  isCurrent: boolean
}

export interface Student {
  id: number
  firstName: string
  lastName: string
  preferredName: string
  email: string
  notes: string
  /** Lowercase. The `advisee` tag lets one record serve both the class and advising roles. */
  tags: string[]
}

export interface ClassRecord {
  id: number
  termId: number
  course: string
  section: string
  period: string
  gradingMode: GradingMode
}

export interface ClassSummary extends ClassRecord {
  termName: string
  studentCount: number
}

export interface GradeCategory {
  id: number
  classId: number
  name: string
  /** A percentage weight, e.g. 40 for 40%. Only used when the class grades by weighted categories. */
  weight: number
  sortOrder: number
}

export interface Assignment {
  id: number
  classId: number
  categoryId: number | null
  title: string
  pointsPossible: number
  dueDate: string | null
  /** Set when another app (for example the Quiz Builder) created this assignment. */
  sourceApp: string | null
  sourceId: string | null
  sortOrder: number
}

export interface Score {
  id: number
  assignmentId: number
  studentId: number
  /** Null means not yet graded. */
  points: number | null
  status: ScoreStatus | null
  comment: string
}

export interface FileLink {
  id: number
  path: string
  recordType: LinkRecordType
  recordId: number
  createdAt: string
}

export interface AppSettings {
  teachingFolders: string[]
  /** An extra folder that also receives every backup. */
  backupFolder: string | null
  presentation: {
    /** Offer to turn presentation mode on when an external display connects. */
    offerOnExternalDisplay: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  teachingFolders: [],
  backupFolder: null,
  presentation: { offerOnExternalDisplay: true }
}

export interface BackupInfo {
  name: string
  path: string
  size: number
  /** ISO timestamp taken from the file name. */
  createdAt: string
  /** Set when the copy to the extra backup folder failed. */
  extraError?: string
  /** The matching vault backup taken alongside this one, if any. */
  vaultName?: string
  /** Set when the vault backup failed (the public backup above still succeeded). */
  vaultError?: string
}
