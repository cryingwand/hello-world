import { API_METHODS, type ApiContract } from './api'

/**
 * Every window has exactly one role, assigned by the main process when it creates the window.
 *
 * - `launcher`: the everyday desktop. Public data only: settings, non-protected files, backups.
 * - `vault`: the protected space: students, classes, the gradebook and protected files.
 * - `stage`: the window on the projector. It can only show what is queued on it.
 */
export type Role = 'launcher' | 'vault' | 'stage'

export interface Access {
  /** Roles allowed to call the method. Anything not listed is refused. */
  roles: readonly Role[]
  /** Also requires the vault to be unlocked (and no presentation running). */
  needsVault?: boolean
}

const VAULT: Access = { roles: ['vault'], needsVault: true }
const EVERYDAY: Access = { roles: ['launcher', 'vault'] }
const LAUNCHER: Access = { roles: ['launcher'] }
/** The lock screen's own calls: the vault window must be able to make them while locked. */
const GATE: Access = { roles: ['vault'] }
/** The projector window: it can ask what to show and nothing else. */
const STAGE: Access = { roles: ['stage'] }

/**
 * Who may call what. This is the single source of truth for the access policy: the main process
 * enforces it on every call and the preload only exposes the methods a window's role may use. The
 * type forces every method in `ApiContract` to be classified, so a new method cannot be added
 * without deciding who may reach it. Default to `VAULT` for anything that touches student data.
 */
export const API_ACCESS = {
  terms: { list: VAULT, create: VAULT, update: VAULT, delete: VAULT },
  students: { list: VAULT, get: VAULT, create: VAULT, update: VAULT, delete: VAULT },
  classes: {
    list: VAULT,
    get: VAULT,
    create: VAULT,
    update: VAULT,
    delete: VAULT,
    roster: VAULT,
    enroll: VAULT,
    unenroll: VAULT,
    forStudent: VAULT
  },
  advising: {
    advisees: VAULT,
    meetings: VAULT,
    createMeeting: VAULT,
    updateMeeting: VAULT,
    deleteMeeting: VAULT,
    goals: VAULT,
    createGoal: VAULT,
    updateGoal: VAULT,
    deleteGoal: VAULT,
    actions: VAULT,
    openActions: VAULT,
    createAction: VAULT,
    updateAction: VAULT,
    deleteAction: VAULT,
    progress: VAULT,
    createProgress: VAULT,
    updateProgress: VAULT,
    deleteProgress: VAULT,
    previewProgressImport: VAULT,
    commitProgressImport: VAULT,
    exportMeetingWord: VAULT
  },
  questions: { list: VAULT, get: VAULT, create: VAULT, update: VAULT, delete: VAULT },
  quizzes: {
    list: VAULT,
    get: VAULT,
    create: VAULT,
    update: VAULT,
    delete: VAULT,
    addQuestions: VAULT,
    removeQuestion: VAULT,
    reorder: VAULT,
    setPoints: VAULT,
    assignments: VAULT,
    createAssignment: VAULT,
    exportWord: VAULT
  },
  units: {
    list: VAULT,
    get: VAULT,
    create: VAULT,
    update: VAULT,
    delete: VAULT,
    reorder: VAULT,
    upcoming: VAULT,
    exportPowerPoint: VAULT
  },
  lessons: { create: VAULT, update: VAULT, delete: VAULT, linkQuiz: VAULT, unlinkQuiz: VAULT },
  grading: {
    categories: VAULT,
    createCategory: VAULT,
    updateCategory: VAULT,
    deleteCategory: VAULT,
    assignments: VAULT,
    createAssignment: VAULT,
    updateAssignment: VAULT,
    deleteAssignment: VAULT,
    scores: VAULT,
    setScore: VAULT,
    setScores: VAULT
  },
  roster: {
    chooseFile: VAULT,
    readSheet: VAULT,
    preview: VAULT,
    commit: VAULT,
    exportClass: VAULT
  },
  gradebook: { previewScores: VAULT, commitScores: VAULT, exportClass: VAULT },
  fileLinks: { list: VAULT, add: VAULT, remove: VAULT },
  protection: { folders: VAULT, chooseAndAdd: VAULT, remove: VAULT, browse: VAULT },
  files: {
    search: EVERYDAY,
    info: EVERYDAY,
    readText: EVERYDAY,
    writeText: EVERYDAY,
    docxHtml: EVERYDAY,
    table: EVERYDAY,
    thumbnail: EVERYDAY,
    open: EVERYDAY,
    reveal: EVERYDAY,
    restoreLayout: EVERYDAY,
    pickFile: EVERYDAY
  },
  settings: { get: EVERYDAY, update: EVERYDAY },
  backup: { runNow: EVERYDAY, list: EVERYDAY },
  system: { info: EVERYDAY, chooseFolder: EVERYDAY, openAccessibilitySettings: EVERYDAY },
  vaultGate: {
    openWindow: LAUNCHER,
    status: EVERYDAY,
    setup: GATE,
    unlock: GATE,
    unlockWithTouchId: GATE,
    lock: EVERYDAY
  },
  vault: { touch: VAULT, changePasscode: VAULT, settings: VAULT, updateSettings: VAULT },
  stage: {
    state: LAUNCHER,
    add: LAUNCHER,
    remove: LAUNCHER,
    move: LAUNCHER,
    clear: LAUNCHER,
    start: LAUNCHER,
    end: LAUNCHER,
    next: LAUNCHER,
    previous: LAUNCHER,
    goto: LAUNCHER,
    blank: LAUNCHER,
    view: STAGE
  }
} as const satisfies { [N in keyof ApiContract]: { [M in keyof ApiContract[N]]: Access } }

type Namespace = keyof typeof API_ACCESS

/** The policy entry for one method, or undefined if it does not exist (which means refuse). */
export function accessFor(ns: string, method: string): Access | undefined {
  const table = API_ACCESS as Record<string, Record<string, Access>>
  // Own properties only: "constructor" or "__proto__" must never resolve to something inherited.
  if (!Object.prototype.hasOwnProperty.call(table, ns)) return undefined
  const group = table[ns]
  return Object.prototype.hasOwnProperty.call(group, method) ? group[method] : undefined
}

export function canCall(role: Role | undefined, ns: string, method: string): boolean {
  if (!role) return false
  return accessFor(ns, method)?.roles.includes(role) ?? false
}

/** The methods a role may see, by namespace. Namespaces with nothing for that role are left out. */
export function methodsFor(role: Role): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const ns of Object.keys(API_METHODS) as Namespace[]) {
    const allowed = (API_METHODS[ns] as readonly string[]).filter((m) => canCall(role, ns, m))
    if (allowed.length > 0) out[ns] = allowed
  }
  return out
}
