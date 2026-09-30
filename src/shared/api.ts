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
  fileLinks: ['list', 'add', 'remove'],
  settings: ['get', 'update'],
  backup: ['runNow', 'list'],
  system: ['info', 'chooseFolder']
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
  platform: string
}
