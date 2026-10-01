import type {
  FileInfo,
  FileSearchQuery,
  FileSearchResponse,
  OpenRequest,
  OpenResult,
  ProtectedFolder,
  ProtectedListing,
  TableView,
  TextFile
} from './files'
import type { QuizVersion } from './quiz'
import type { QuizForm } from './quizForms'
import type { StageState, StageView } from './stage'
import type { VaultSettings, VaultStatus } from './vault'
import type { ScoreImportPlan, ScoreImportRequest, ScoreImportResult } from './scoreImport'
import type { ImportPreview, ImportRequest, ImportResult, TableFile } from './roster'
import type {
  ProgressImportPlan,
  ProgressImportRequest,
  ProgressImportResult
} from './progressImport'
import type {
  ActionItem,
  ActionOwner,
  AdviseeSummary,
  AdvisingGoal,
  AdvisingMeeting,
  AppSettings,
  Assignment,
  BackupInfo,
  ClassRecord,
  ClassSummary,
  ExternalProgress,
  FileLink,
  GoalStatus,
  GradeCategory,
  GradingMode,
  LinkRecordType,
  Question,
  QuestionKind,
  QuizDetail,
  QuizKind,
  QuizSummary,
  Score,
  ScoreStatus,
  Student,
  Term,
  Lesson,
  UnitDetail,
  UnitSummary,
  UpcomingLesson
} from './models'

export interface TermInput {
  name: string
  startDate?: string | null
  endDate?: string | null
  isCurrent?: boolean
}

export interface StudentInput {
  firstName: string
  lastName: string
  preferredName?: string
  email?: string
  notes?: string
  tags?: string[]
}

export interface StudentQuery {
  search?: string
  tag?: string
  /** Only students enrolled in this class. */
  classId?: number
}

export interface ClassInput {
  termId: number
  course: string
  section?: string
  period?: string
  gradingMode: GradingMode
}

export interface CategoryInput {
  classId: number
  name: string
  weight: number
}

export interface AssignmentInput {
  classId: number
  categoryId?: number | null
  title: string
  pointsPossible: number
  dueDate?: string | null
  sourceApp?: string | null
  sourceId?: string | null
}

export interface ScoreInput {
  assignmentId: number
  studentId: number
  points: number | null
  status: ScoreStatus | null
  comment?: string
}

export interface FileLinkInput {
  path: string
  recordType: LinkRecordType
  recordId: number
}

export interface MeetingInput {
  studentId: number
  /** YYYY-MM-DD */
  metOn: string
  topic?: string
  notes?: string
  summary?: string
}

export interface GoalInput {
  studentId: number
  title: string
  details?: string
  targetDate?: string | null
  status?: GoalStatus
}

export interface ActionInput {
  studentId: number
  meetingId?: number | null
  goalId?: number | null
  title: string
  dueDate?: string | null
  owner?: ActionOwner
  /** Mark done (today's date is recorded) or open again. */
  done?: boolean
}

export interface ProgressInput {
  studentId: number
  course: string
  term?: string
  grade?: string
  source?: string
  recordedOn?: string | null
}

export interface QuestionInput {
  kind: QuestionKind
  prompt: string
  /** Multiple choice only; true/false is always True then False. */
  choices?: string[]
  correctChoice?: number | null
  answer?: string
  points?: number
  tags?: string[]
}

export interface QuestionQuery {
  /** Matches the question text and its choices. */
  search?: string
  kind?: QuestionKind
  tag?: string
}

export interface QuizInput {
  kind?: QuizKind
  title: string
  course?: string
  date?: string | null
  instructions?: string
}

export interface QuizAssignmentInput {
  quizId: number
  classId: number
  categoryId?: number | null
  /** Defaults to the quiz's date. */
  dueDate?: string | null
}

export interface UnitInput {
  title: string
  course?: string
  summary?: string
}

export interface LessonInput {
  unitId: number
  title: string
  /** YYYY-MM-DD */
  date?: string | null
  /** One per line. */
  objectives?: string
  /** One step per line. */
  plan?: string
  homework?: string
  /** Teacher only: speaker notes in the PowerPoint. */
  notes?: string
}

export interface SystemInfo {
  dataDir: string
  dbPath: string
  vaultPath: string
  backupDir: string
  platform: string
  version: string
}

type Patch<T> = Partial<T>
type Awaitable<T> = T | Promise<T>

/**
 * The typed surface between renderer and main. `window.api.<namespace>.<method>(...)` calls the
 * matching implementation in the main process (see src/main/api.ts). Every method is async to
 * the renderer regardless of how it is implemented.
 */
export interface ApiContract {
  terms: {
    list(): Term[]
    create(input: TermInput): Term
    update(id: number, patch: Patch<TermInput>): Term
    delete(id: number): void
  }
  students: {
    list(query?: StudentQuery): Student[]
    get(id: number): Student | null
    create(input: StudentInput): Student
    update(id: number, patch: Patch<StudentInput>): Student
    delete(id: number): void
  }
  classes: {
    list(termId?: number): ClassSummary[]
    get(id: number): ClassRecord | null
    create(input: ClassInput): ClassRecord
    update(id: number, patch: Patch<ClassInput>): ClassRecord
    delete(id: number): void
    /** Enrolled students, ordered by last then first name. */
    roster(classId: number): Student[]
    enroll(classId: number, studentId: number): void
    unenroll(classId: number, studentId: number): void
    /** Classes a student is enrolled in. */
    forStudent(studentId: number): ClassSummary[]
  }
  advising: {
    /** Students tagged `advisee`, with what needs attention. */
    advisees(): AdviseeSummary[]
    /** Newest first. */
    meetings(studentId: number): AdvisingMeeting[]
    createMeeting(input: MeetingInput): AdvisingMeeting
    updateMeeting(id: number, patch: Patch<Omit<MeetingInput, 'studentId'>>): AdvisingMeeting
    deleteMeeting(id: number): void
    goals(studentId: number): AdvisingGoal[]
    createGoal(input: GoalInput): AdvisingGoal
    updateGoal(id: number, patch: Patch<Omit<GoalInput, 'studentId'>>): AdvisingGoal
    deleteGoal(id: number): void
    /** One advisee's follow-ups, open ones first. */
    actions(studentId: number): ActionItem[]
    /** Every open follow-up for every advisee, earliest due first. */
    openActions(): ActionItem[]
    createAction(input: ActionInput): ActionItem
    updateAction(id: number, patch: Patch<Omit<ActionInput, 'studentId'>>): ActionItem
    deleteAction(id: number): void
    progress(studentId: number): ExternalProgress[]
    createProgress(input: ProgressInput): ExternalProgress
    updateProgress(id: number, patch: Patch<Omit<ProgressInput, 'studentId'>>): ExternalProgress
    deleteProgress(id: number): void
    /** What importing this spreadsheet of outside grades would do, without writing anything. */
    previewProgressImport(request: ProgressImportRequest): Awaitable<ProgressImportPlan>
    commitProgressImport(request: ProgressImportRequest): Awaitable<ProgressImportResult>
    /** Asks where to save, then writes the meeting up as a Word file. Null if cancelled. */
    exportMeetingWord(meetingId: number): Awaitable<{ path: string } | null>
  }
  questions: {
    /** Newest first. */
    list(query?: QuestionQuery): Question[]
    get(id: number): Question | null
    create(input: QuestionInput): Question
    update(id: number, patch: Patch<QuestionInput>): Question
    /** Refused while any quiz uses the question. */
    delete(id: number): void
  }
  quizzes: {
    list(): QuizSummary[]
    get(id: number): QuizDetail | null
    create(input: QuizInput): QuizDetail
    update(id: number, patch: Patch<QuizInput>): QuizDetail
    /** Gradebook assignments made from it are kept, but no longer point back at it. */
    delete(id: number): void
    /** Appends to the end, in the order given. Questions already in the quiz are skipped. */
    addQuestions(id: number, questionIds: number[]): QuizDetail
    removeQuestion(id: number, questionId: number): QuizDetail
    /** Every question in the quiz, in the new order. */
    reorder(id: number, questionIds: number[]): QuizDetail
    /** Points for this quiz only; null goes back to the question's own. */
    setPoints(id: number, questionId: number, points: number | null): QuizDetail
    /** The Gradebook assignments created from this quiz, one per class. */
    assignments(id: number): Assignment[]
    /** Creates the assignment in a class, worth the quiz's total points. One per class. */
    createAssignment(input: QuizAssignmentInput): Assignment
    /**
     * Asks where to save, then writes a Word copy: for students, or the answer key. Form B has the
     * questions and choices shuffled (the same shuffle for the copy and its key). Null if cancelled.
     */
    exportWord(
      id: number,
      version: QuizVersion,
      form?: QuizForm | null
    ): Awaitable<{ path: string } | null>
  }
  units: {
    /** By course, then by when the unit starts. */
    list(): UnitSummary[]
    get(id: number): UnitDetail | null
    create(input: UnitInput): UnitDetail
    update(id: number, patch: Patch<UnitInput>): UnitDetail
    /** Takes its lessons, and their attached-file links, with it. Quizzes are untouched. */
    delete(id: number): void
    /** Every lesson in the unit, in the new order. */
    reorder(id: number, lessonIds: number[]): UnitDetail
    /** Lessons dated today or later, soonest first. */
    upcoming(): UpcomingLesson[]
    /**
     * Asks where to save, then writes a PowerPoint for the unit, or for one of its lessons. Only quiz
     * titles go in it, never questions. Null if cancelled.
     */
    exportPowerPoint(id: number, lessonId?: number | null): Awaitable<{ path: string } | null>
  }
  lessons: {
    /** Added at the end of its unit. */
    create(input: LessonInput): Lesson
    update(id: number, patch: Patch<Omit<LessonInput, 'unitId'>>): Lesson
    delete(id: number): void
    /** Records that the lesson uses a quiz or exam. Linking twice is harmless. */
    linkQuiz(id: number, quizId: number): Lesson
    unlinkQuiz(id: number, quizId: number): Lesson
  }
  grading: {
    categories(classId: number): GradeCategory[]
    createCategory(input: CategoryInput): GradeCategory
    updateCategory(id: number, patch: Patch<Omit<CategoryInput, 'classId'>>): GradeCategory
    deleteCategory(id: number): void
    assignments(classId: number): Assignment[]
    createAssignment(input: AssignmentInput): Assignment
    updateAssignment(id: number, patch: Patch<Omit<AssignmentInput, 'classId'>>): Assignment
    deleteAssignment(id: number): void
    scores(classId: number): Score[]
    setScore(input: ScoreInput): Score | null
    setScores(inputs: ScoreInput[]): void
  }
  roster: {
    /** Opens a native file picker for .xlsx/.csv and reads the chosen file. Null if cancelled. */
    chooseFile(): Awaitable<TableFile | null>
    /** Re-reads a previously chosen file, on a different worksheet. */
    readSheet(token: string, sheet: string): Awaitable<TableFile>
    preview(request: ImportRequest): Awaitable<ImportPreview>
    commit(request: ImportRequest): Awaitable<ImportResult>
    /** Asks where to save, then writes the class roster. Null if cancelled. */
    exportClass(classId: number, format: 'xlsx' | 'csv'): Awaitable<{ path: string } | null>
  }
  vaultGate: {
    /** Opens (or focuses) the Vault window, which holds the gradebook, students and protected files. */
    openWindow(): Awaitable<void>
    status(): Awaitable<VaultStatus>
    /** First run: choose the passcode (and optionally turn on Touch ID). Opens the vault. */
    setup(passcode: string, touchId?: boolean): Awaitable<VaultStatus>
    unlock(passcode: string): Awaitable<VaultStatus>
    unlockWithTouchId(): Awaitable<VaultStatus>
    /** Locks at once: the database closes and every vault window closes. */
    lock(): Awaitable<void>
  }
  vault: {
    /** Real activity (a click or key press) in the vault: restarts the idle-lock countdown. */
    touch(): Awaitable<void>
    changePasscode(current: string, next: string): Awaitable<void>
    settings(): Awaitable<VaultSettings>
    updateSettings(patch: {
      autoLockMinutes?: number
      touchIdEnabled?: boolean
    }): Awaitable<VaultSettings>
  }
  stage: {
    /** Presenter: the queue, and whether the Stage is showing. No paths are returned. */
    state(): Awaitable<StageState>
    /** Adds files to the queue. Each must be a PDF, image, Word or text file outside protected folders. */
    add(paths: string[]): Awaitable<StageState>
    remove(index: number): Awaitable<StageState>
    move(from: number, to: number): Awaitable<StageState>
    clear(): Awaitable<StageState>
    /** Locks the Vault, then opens the Stage window on the other display (or this one). */
    start(): Awaitable<StageState>
    end(): Awaitable<StageState>
    next(): Awaitable<StageState>
    previous(): Awaitable<StageState>
    goto(index: number): Awaitable<StageState>
    blank(on?: boolean): Awaitable<StageState>
    /** The Stage window only: what to show right now. */
    view(): Awaitable<StageView>
  }
  gradebook: {
    /** What importing this file would do, without writing anything. */
    previewScores(request: ScoreImportRequest): Awaitable<ScoreImportPlan>
    commitScores(request: ScoreImportRequest): Awaitable<ScoreImportResult>
    /** Asks where to save, then writes the class's scores. Null if cancelled. */
    exportClass(classId: number, format: 'xlsx' | 'csv'): Awaitable<{ path: string } | null>
  }
  files: {
    /** Spotlight search with teaching folders ranked first. */
    search(query: FileSearchQuery): Awaitable<FileSearchResponse>
    /** Null if the file is gone. */
    info(path: string): Awaitable<FileInfo | null>
    readText(path: string): Awaitable<TextFile>
    writeText(path: string, text: string, expectedMtime: number): Awaitable<{ mtime: number }>
    docxHtml(path: string): Awaitable<{ html: string; messages: string[] }>
    table(path: string, sheet?: string | null): Awaitable<TableView>
    /** A Quick Look thumbnail as a data URL, or null when none is available. */
    thumbnail(path: string): Awaitable<string | null>
    /** Opens in a native app and optionally snaps it beside the launcher. */
    open(request: OpenRequest): Awaitable<OpenResult>
    reveal(path: string): Awaitable<void>
    /** Puts the launcher back where it was before a snap. */
    restoreLayout(): Awaitable<void>
    /** Native file picker, for attaching a file that search does not find. */
    pickFile(): Awaitable<string | null>
  }
  protection: {
    /** The protected folders. Only the unlocked Vault can see or change them. */
    folders(): Awaitable<ProtectedFolder[]>
    /** Shows a folder picker (in the main process) and protects the folder that is chosen. */
    chooseAndAdd(): Awaitable<ProtectedFolder[]>
    remove(path: string): Awaitable<ProtectedFolder[]>
    /** One level of a protected folder. Refuses anything that is not inside one. */
    browse(dir: string): Awaitable<ProtectedListing>
  }
  fileLinks: {
    list(recordType: LinkRecordType, recordId: number): FileLink[]
    add(input: FileLinkInput): FileLink
    remove(id: number): void
  }
  settings: {
    get(): AppSettings
    update(patch: Patch<AppSettings>): AppSettings
  }
  backup: {
    runNow(): Awaitable<BackupInfo>
    list(): BackupInfo[]
  }
  system: {
    info(): SystemInfo
    /** Opens a native folder picker. Null if cancelled. */
    chooseFolder(): Awaitable<string | null>
    /** Opens System Settings at Privacy & Security, Accessibility. */
    openAccessibilitySettings(): Awaitable<void>
  }
}

/** Runtime list of every method, used to build the preload bridge and to catch drift. */
export const API_METHODS = {
  terms: ['list', 'create', 'update', 'delete'],
  students: ['list', 'get', 'create', 'update', 'delete'],
  classes: [
    'list',
    'get',
    'create',
    'update',
    'delete',
    'roster',
    'enroll',
    'unenroll',
    'forStudent'
  ],
  advising: [
    'advisees',
    'meetings',
    'createMeeting',
    'updateMeeting',
    'deleteMeeting',
    'goals',
    'createGoal',
    'updateGoal',
    'deleteGoal',
    'actions',
    'openActions',
    'createAction',
    'updateAction',
    'deleteAction',
    'progress',
    'createProgress',
    'updateProgress',
    'deleteProgress',
    'previewProgressImport',
    'commitProgressImport',
    'exportMeetingWord'
  ],
  questions: ['list', 'get', 'create', 'update', 'delete'],
  quizzes: [
    'list',
    'get',
    'create',
    'update',
    'delete',
    'addQuestions',
    'removeQuestion',
    'reorder',
    'setPoints',
    'assignments',
    'createAssignment',
    'exportWord'
  ],
  units: ['list', 'get', 'create', 'update', 'delete', 'reorder', 'upcoming', 'exportPowerPoint'],
  lessons: ['create', 'update', 'delete', 'linkQuiz', 'unlinkQuiz'],
  grading: [
    'categories',
    'createCategory',
    'updateCategory',
    'deleteCategory',
    'assignments',
    'createAssignment',
    'updateAssignment',
    'deleteAssignment',
    'scores',
    'setScore',
    'setScores'
  ],
  roster: ['chooseFile', 'readSheet', 'preview', 'commit', 'exportClass'],
  vaultGate: ['openWindow', 'status', 'setup', 'unlock', 'unlockWithTouchId', 'lock'],
  vault: ['touch', 'changePasscode', 'settings', 'updateSettings'],
  stage: [
    'state',
    'add',
    'remove',
    'move',
    'clear',
    'start',
    'end',
    'next',
    'previous',
    'goto',
    'blank',
    'view'
  ],
  gradebook: ['previewScores', 'commitScores', 'exportClass'],
  files: [
    'search',
    'info',
    'readText',
    'writeText',
    'docxHtml',
    'table',
    'thumbnail',
    'open',
    'reveal',
    'restoreLayout',
    'pickFile'
  ],
  protection: ['folders', 'chooseAndAdd', 'remove', 'browse'],
  fileLinks: ['list', 'add', 'remove'],
  settings: ['get', 'update'],
  backup: ['runNow', 'list'],
  system: ['info', 'chooseFolder', 'openAccessibilitySettings']
} as const satisfies { [N in keyof ApiContract]: readonly (keyof ApiContract[N])[] }

export type Api = {
  [N in keyof ApiContract]: {
    [M in keyof ApiContract[N]]: ApiContract[N][M] extends (...args: infer A) => infer R
      ? (...args: A) => Promise<Awaited<R>>
      : never
  }
}

export interface RendererApi extends Api {
  onChange(listener: (event: import('./events').ChangeEvent) => void): () => void
  onStageState(listener: (state: StageState) => void): () => void
  onStageView(listener: (view: StageView) => void): () => void
  onVaultStatus(listener: (status: VaultStatus) => void): () => void
  onDisplayOffer(listener: (offer: import('./events').DisplayOffer) => void): () => void
  platform: string
  /** This window's role, as recorded by the main process. Null if the window is unknown. */
  role: import('./access').Role | null
}
