export type GradingMode = 'weighted' | 'points'
export type ScoreStatus = 'missing' | 'excused' | 'late'
export type LinkRecordType = 'student' | 'class' | 'term' | 'unit' | 'lesson'

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

export type QuestionKind = 'multiple-choice' | 'true-false' | 'short-answer' | 'essay'

/** A reusable question in the bank. */
export interface Question {
  id: number
  kind: QuestionKind
  prompt: string
  /** Multiple choice: 2 to 6 options. True/false: always True then False. Otherwise empty. */
  choices: string[]
  /** Index into `choices` of the right answer. Null for short answer and essay. */
  correctChoice: number | null
  /** Short answer and essay: the model answer or marking notes (shown on the answer key only). */
  answer: string
  /** Points the question is worth unless a quiz overrides it. */
  points: number
  /** Lowercase. */
  tags: string[]
  /** How many quizzes use it. A question that is in a quiz cannot be deleted. */
  quizCount: number
}

export type QuizKind = 'quiz' | 'exam'

export interface Quiz {
  id: number
  kind: QuizKind
  title: string
  /** Printed in the header, for example "PHIL 101". */
  course: string
  /** YYYY-MM-DD, printed in the header. */
  date: string | null
  /** Directions printed under the header. */
  instructions: string
}

/** One question in a quiz, in order. */
export interface QuizEntry {
  questionId: number
  position: number
  /** A points value that replaces the question's own for this quiz only. */
  pointsOverride: number | null
  /** What it is worth in this quiz: the override, else the question's own. */
  points: number
  question: Question
}

export interface QuizDetail extends Quiz {
  entries: QuizEntry[]
  totalPoints: number
}

/** One row of the quiz list. */
export interface QuizSummary extends Quiz {
  questionCount: number
  totalPoints: number
  /** Gradebook assignments created from it. */
  assignmentCount: number
}

/** A run of lessons on one topic. */
export interface Unit {
  id: number
  title: string
  /** For example "PHIL 101". Free text, like a quiz's course. */
  course: string
  /** Big ideas and goals for the unit. */
  summary: string
}

/** A quiz or exam a lesson uses. Only what is needed to name it; the questions stay in the Quizzes app. */
export interface LinkedQuiz {
  id: number
  kind: QuizKind
  title: string
  date: string | null
}

/** A class a lesson is taught to. Just enough to name it. */
export interface LinkedClass {
  id: number
  course: string
  section: string
  period: string
  termName: string
}

/** A Gradebook assignment that goes with a lesson (its homework or quiz). */
export interface LinkedAssignment {
  id: number
  classId: number
  title: string
  pointsPossible: number
  dueDate: string | null
}

export interface Lesson {
  id: number
  unitId: number
  /** 0-based place in the unit. */
  position: number
  title: string
  /** YYYY-MM-DD. */
  date: string | null
  /** One per line. */
  objectives: string
  /** What happens in class, one step per line. */
  plan: string
  homework: string
  /** For the teacher only: become speaker notes in the PowerPoint. */
  notes: string
  quizzes: LinkedQuiz[]
  /** The classes it is taught to. */
  classes: LinkedClass[]
  /** Gradebook assignments for it. Each is in one of `classes`. */
  assignments: LinkedAssignment[]
}

export interface UnitDetail extends Unit {
  lessons: Lesson[]
}

/** One row of the unit list. */
export interface UnitSummary extends Unit {
  lessonCount: number
  /** Earliest and latest lesson dates, if any lesson has one. */
  firstDate: string | null
  lastDate: string | null
}

/** A dated lesson that has not happened yet, with where it belongs. */
export interface UpcomingLesson {
  lesson: Lesson
  unitTitle: string
  course: string
}
