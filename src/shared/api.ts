import type {
  FileInfo,
  FileSearchQuery,
  FileSearchResponse,
  OpenRequest,
  OpenResult,
  TableView,
  TextFile
} from './files'
import type { ScoreImportPlan, ScoreImportRequest, ScoreImportResult } from './scoreImport'
import type { ImportPreview, ImportRequest, ImportResult, TableFile } from './roster'
import type {
  AppSettings,
  Assignment,
  BackupInfo,
  ClassRecord,
  ClassSummary,
  FileLink,
  GradeCategory,
  GradingMode,
  LinkRecordType,
  Score,
  ScoreStatus,
  Student,
  Term
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

export interface SystemInfo {
  dataDir: string
  dbPath: string
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
  }
  presentation: {
    /** The window reports whether presentation mode is on; main uses it for the menu and to hold notifications. */
    setActive(on: boolean): Awaitable<void>
    /** Whether an external display is connected right now, and whether the offer should be shown. */
    state(): Awaitable<{ externalDisplays: number; offerEnabled: boolean }>
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
  vaultGate: ['openWindow'],
  presentation: ['setActive', 'state'],
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
  onPresentationToggle(listener: () => void): () => void
  onDisplayOffer(listener: (offer: import('./events').DisplayOffer) => void): () => void
  platform: string
  /** This window's role, as recorded by the main process. Null if the window is unknown. */
  role: import('./access').Role | null
}
