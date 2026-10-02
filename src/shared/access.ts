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
  /**
   * Deletes or overwrites Vault data that a later edit cannot bring back, so a Vault backup is taken
   * first (at most one a minute). If it cannot be taken, the call is refused.
   */
  backupFirst?: boolean
  /**
   * Changes the Mac's own files or calendar. Refused in the Preview app, which runs a version still
   * being worked on against a copy of the data: the Mac's files and calendar are not copies.
   */
  changesMac?: boolean
}

const VAULT: Access = { roles: ['vault'], needsVault: true }
/** A Vault method that deletes or overwrites data: backed up first. */
const VAULT_DESTRUCTIVE: Access = { roles: ['vault'], needsVault: true, backupFirst: true }
const EVERYDAY: Access = { roles: ['launcher', 'vault'] }
const LAUNCHER: Access = { roles: ['launcher'] }
/** An everyday method that changes the Mac's files or calendar. */
const EVERYDAY_MAC_WRITE: Access = { roles: ['launcher', 'vault'], changesMac: true }
/** The lock screen's own calls: the vault window must be able to make them while locked. */
const GATE: Access = { roles: ['vault'] }
/** The projector window: it can ask what to show and nothing else. */
const STAGE: Access = { roles: ['stage'] }

/**
 * Who may call what. This is the single source of truth for the access policy: the main process
 * enforces it on every call and the preload only exposes the methods a window's role may use. The
 * type forces every method in `ApiContract` to be classified, so a new method cannot be added
 * without deciding who may reach it. Default to `VAULT` for anything that touches student data, and
 * `VAULT_DESTRUCTIVE` for anything that deletes or overwrites it.
 */
export const API_ACCESS = {
  terms: { list: VAULT, create: VAULT, update: VAULT, delete: VAULT_DESTRUCTIVE },
  students: { list: VAULT, get: VAULT, create: VAULT, update: VAULT, delete: VAULT_DESTRUCTIVE },
  classes: {
    list: VAULT,
    get: VAULT,
    create: VAULT,
    update: VAULT,
    delete: VAULT_DESTRUCTIVE,
    roster: VAULT,
    enroll: VAULT,
    // Also deletes the student's scores in that class.
    unenroll: VAULT_DESTRUCTIVE,
    forStudent: VAULT
  },
  advising: {
    advisees: VAULT,
    meetings: VAULT,
    createMeeting: VAULT,
    updateMeeting: VAULT,
    deleteMeeting: VAULT_DESTRUCTIVE,
    goals: VAULT,
    createGoal: VAULT,
    updateGoal: VAULT,
    deleteGoal: VAULT_DESTRUCTIVE,
    actions: VAULT,
    openActions: VAULT,
    createAction: VAULT,
    updateAction: VAULT,
    deleteAction: VAULT_DESTRUCTIVE,
    progress: VAULT,
    createProgress: VAULT,
    updateProgress: VAULT,
    deleteProgress: VAULT_DESTRUCTIVE,
    previewProgressImport: VAULT,
    commitProgressImport: VAULT_DESTRUCTIVE,
    exportMeetingWord: VAULT
  },
  questions: { list: VAULT, get: VAULT, create: VAULT, update: VAULT, delete: VAULT_DESTRUCTIVE },
  quizzes: {
    list: VAULT,
    get: VAULT,
    create: VAULT,
    update: VAULT,
    delete: VAULT_DESTRUCTIVE,
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
    delete: VAULT_DESTRUCTIVE,
    duplicate: VAULT,
    reorder: VAULT,
    upcoming: VAULT,
    roadmap: VAULT,
    todo: VAULT,
    exportPowerPoint: VAULT
  },
  lessons: {
    create: VAULT,
    update: VAULT,
    delete: VAULT_DESTRUCTIVE,
    duplicate: VAULT,
    move: VAULT,
    linkQuiz: VAULT,
    unlinkQuiz: VAULT,
    linkClass: VAULT,
    unlinkClass: VAULT,
    linkAssignment: VAULT,
    unlinkAssignment: VAULT,
    addBlock: VAULT,
    updateBlock: VAULT,
    deleteBlock: VAULT_DESTRUCTIVE,
    reorderBlocks: VAULT,
    addTask: VAULT,
    updateTask: VAULT,
    deleteTask: VAULT_DESTRUCTIVE
  },
  grading: {
    categories: VAULT,
    createCategory: VAULT,
    updateCategory: VAULT,
    deleteCategory: VAULT_DESTRUCTIVE,
    assignments: VAULT,
    createAssignment: VAULT,
    updateAssignment: VAULT,
    deleteAssignment: VAULT_DESTRUCTIVE,
    scores: VAULT,
    setScore: VAULT,
    setScores: VAULT
  },
  roster: {
    chooseFile: VAULT,
    readSheet: VAULT,
    preview: VAULT,
    commit: VAULT_DESTRUCTIVE,
    exportClass: VAULT
  },
  gradebook: { previewScores: VAULT, commitScores: VAULT_DESTRUCTIVE, exportClass: VAULT },
  fileLinks: { list: VAULT, add: VAULT, remove: VAULT },
  protection: { folders: VAULT, chooseAndAdd: VAULT, remove: VAULT, browse: VAULT },
  files: {
    search: EVERYDAY,
    info: EVERYDAY,
    readText: EVERYDAY,
    writeText: EVERYDAY_MAC_WRITE,
    docxHtml: EVERYDAY,
    table: EVERYDAY,
    thumbnail: EVERYDAY,
    open: EVERYDAY,
    reveal: EVERYDAY,
    restoreLayout: EVERYDAY,
    pickFile: EVERYDAY
  },
  // The Mac's folders. Protected files stay out of the everyday window through its file guard.
  folders: {
    places: EVERYDAY,
    list: EVERYDAY,
    createFolder: EVERYDAY_MAC_WRITE,
    rename: EVERYDAY_MAC_WRITE,
    move: EVERYDAY_MAC_WRITE,
    trash: EVERYDAY_MAC_WRITE
  },
  // The everyday desktop's arrangement lives in the everyday window only.
  desk: { items: LAUNCHER, pin: LAUNCHER, addArea: LAUNCHER, arrange: LAUNCHER, remove: LAUNCHER },
  // The teacher chose to have the calendar in the everyday window too; the Vault's planner adds lessons.
  calendar: {
    status: EVERYDAY,
    calendars: EVERYDAY,
    events: EVERYDAY,
    create: EVERYDAY_MAC_WRITE,
    delete: EVERYDAY_MAC_WRITE
  },
  // The names-only roster copy: read-only, for the everyday window, and available while the Vault is locked.
  directory: { classes: LAUNCHER, students: LAUNCHER },
  settings: { get: EVERYDAY, update: EVERYDAY },
  backup: { runNow: EVERYDAY, list: EVERYDAY },
  system: { info: EVERYDAY, chooseFolder: EVERYDAY, openAccessibilitySettings: EVERYDAY },
  // Updating the app: from the everyday window's Settings only. No student data is involved.
  updates: {
    status: LAUNCHER,
    check: LAUNCHER,
    install: LAUNCHER,
    tryPreview: LAUNCHER,
    refreshPreview: LAUNCHER,
    removePreview: LAUNCHER
  },
  vaultGate: {
    openWindow: LAUNCHER,
    status: EVERYDAY,
    setup: GATE,
    unlock: GATE,
    unlockWithTouchId: GATE,
    lock: EVERYDAY
  },
  vault: {
    touch: VAULT,
    changePasscode: VAULT,
    settings: VAULT,
    updateSettings: VAULT,
    backups: VAULT,
    // Takes its own backup of the Vault as it is now before replacing it.
    restore: VAULT
  },
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
    // In-class Tools put names on the projector: only the everyday window, only while presenting.
    showTool: LAUNCHER,
    setTimer: LAUNCHER,
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
