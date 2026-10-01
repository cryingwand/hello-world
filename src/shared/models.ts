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

export type GoalStatus = 'active' | 'achieved' | 'dropped'
/** Whose follow-up it is: the advisee's, or the teacher's own. */
export type ActionOwner = 'student' | 'me'

export interface AdvisingMeeting {
  id: number
  studentId: number
  /** YYYY-MM-DD */
  metOn: string
  topic: string
  /** Working notes taken during the meeting. */
  notes: string
  /** The tidy version written afterwards, the one that is shared or copied out. */
  summary: string
}

export interface AdvisingGoal {
  id: number
  studentId: number
  title: string
  details: string
  targetDate: string | null
  status: GoalStatus
}

export interface ActionItem {
  id: number
  studentId: number
  /** The meeting it came out of, if any. */
  meetingId: number | null
  goalId: number | null
  title: string
  dueDate: string | null
  owner: ActionOwner
  /** Set (YYYY-MM-DD) when done; null while open. */
  completedOn: string | null
}

/** A grade the advisee earned somewhere else (another school, an online course). Entered by hand. */
export interface ExternalProgress {
  id: number
  studentId: number
  course: string
  term: string
  /** Free text: "B+", "87", "In progress". */
  grade: string
  source: string
  recordedOn: string | null
}

/** One row of the Advising roster. */
export interface AdviseeSummary {
  student: Student
  lastMeetingOn: string | null
  activeGoals: number
  openActions: number
  /** The earliest due date among open follow-ups, so the roster can flag the overdue ones. */
  nextDue: string | null
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
    /** Offer the Stage when an external display connects. The Vault locks either way. */
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
