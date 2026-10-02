import { describe, expect, it } from 'vitest'
import { API_ACCESS, accessFor, canCall, methodsFor, type Access, type Role } from '@shared/access'
import { API_METHODS } from '@shared/api'
import { CHANGE_AUDIENCE, CHANGE_NAMES } from '@shared/events'

describe('access policy', () => {
  it('classifies every API method, and nothing that does not exist', () => {
    for (const ns of Object.keys(API_METHODS) as (keyof typeof API_METHODS)[]) {
      const declared = [...API_METHODS[ns]].sort()
      const classified = Object.keys(API_ACCESS[ns]).sort()
      expect(classified, ns).toEqual(declared)
    }
    expect(Object.keys(API_ACCESS).sort()).toEqual(Object.keys(API_METHODS).sort())
  })

  it('keeps everything that touches student data vault-only, and needing the vault', () => {
    const vaultOnly = [
      'advising',
      'questions',
      'quizzes',
      'units',
      'lessons',
      'terms',
      'students',
      'classes',
      'grading',
      'roster',
      'gradebook',
      'fileLinks',
      'protection'
    ]
    for (const ns of vaultOnly) {
      for (const [method, access] of Object.entries(API_ACCESS[ns as keyof typeof API_ACCESS])) {
        expect(access.roles, `${ns}.${method}`).toEqual(['vault'])
        expect((access as { needsVault?: boolean }).needsVault, `${ns}.${method}`).toBe(true)
      }
    }
  })

  it('backs up the Vault before every call that deletes or imports over its data', () => {
    for (const [ns, group] of Object.entries(API_ACCESS)) {
      for (const [method, access] of Object.entries(group) as [string, Access][]) {
        const destructive = access.needsVault === true && /^(delete|commit|unenroll$)/.test(method)
        expect(access.backupFirst === true, `${ns}.${method}`).toBe(destructive)
      }
    }
  })

  it('gives the launcher no method that can read or change student or grade data', () => {
    const launcher = methodsFor('launcher')
    for (const ns of [
      'protection',
      'advising',
      'questions',
      'quizzes',
      'units',
      'lessons',
      'terms',
      'students',
      'classes',
      'grading',
      'roster',
      'gradebook',
      'fileLinks'
    ]) {
      expect(launcher[ns], ns).toBeUndefined()
    }
  })

  it('gives the stage exactly one method: asking what to show', () => {
    expect(methodsFor('stage')).toEqual({ stage: ['view'] })
  })

  it('keeps Stage controls with the launcher: the vault and the stage cannot drive it', () => {
    for (const m of [
      'start',
      'end',
      'add',
      'remove',
      'move',
      'clear',
      'next',
      'previous',
      'goto',
      'blank',
      'state'
    ]) {
      expect(canCall('launcher', 'stage', m), m).toBe(true)
      expect(canCall('vault', 'stage', m), m).toBe(false)
      expect(canCall('stage', 'stage', m), m).toBe(false)
    }
    expect(canCall('stage', 'stage', 'view')).toBe(true)
    expect(canCall('launcher', 'stage', 'view')).toBe(false)
    expect(canCall('vault', 'stage', 'view')).toBe(false)
  })

  it('gives the stage nothing else at all (exhaustive)', () => {
    for (const ns of Object.keys(API_ACCESS) as (keyof typeof API_ACCESS)[]) {
      for (const method of Object.keys(API_ACCESS[ns])) {
        const allowed = canCall('stage', ns, method)
        expect(allowed, `${ns}.${method}`).toBe(ns === 'stage' && method === 'view')
      }
    }
  })

  it('refuses unknown roles, namespaces and methods', () => {
    expect(canCall(undefined, 'files', 'search')).toBe(false)
    expect(canCall('launcher', 'nope', 'search')).toBe(false)
    expect(canCall('launcher', 'files', 'nope')).toBe(false)
    expect(accessFor('constructor', 'name')).toBeUndefined()
    expect(accessFor('files', 'hasOwnProperty')).toBeUndefined()
    expect(accessFor('__proto__', 'x')).toBeUndefined()
  })

  it('lets the launcher and vault both use everyday methods, but only the vault opens students', () => {
    expect(canCall('launcher', 'files', 'search')).toBe(true)
    expect(canCall('vault', 'files', 'search')).toBe(true)
    expect(canCall('launcher', 'students', 'list')).toBe(false)
    expect(canCall('stage', 'students', 'list')).toBe(false)
    expect(canCall('vault', 'students', 'list')).toBe(true)
    expect(canCall('launcher', 'vaultGate', 'openWindow')).toBe(true)
    expect(canCall('vault', 'vaultGate', 'openWindow')).toBe(false)
  })

  it('methodsFor matches canCall exactly for each role', () => {
    for (const role of ['launcher', 'vault', 'stage'] as Role[]) {
      const shown = methodsFor(role)
      for (const ns of Object.keys(API_METHODS) as (keyof typeof API_METHODS)[]) {
        for (const m of API_METHODS[ns] as readonly string[]) {
          expect(shown[ns]?.includes(m) ?? false, `${role} ${ns}.${m}`).toBe(canCall(role, ns, m))
        }
      }
    }
  })
})

describe('the Preview app', () => {
  it("marks every call that changes the Mac's files or calendar, and nothing else", () => {
    // The Preview runs on a copy of the data, but the Mac's files and calendar are the real ones:
    // main refuses these there. A new method that writes to the Mac must be marked too.
    const changesMac: string[] = []
    for (const [ns, group] of Object.entries(API_ACCESS)) {
      for (const [method, access] of Object.entries(group) as [string, Access][]) {
        if (access.changesMac) changesMac.push(`${ns}.${method}`)
      }
    }
    expect(changesMac.sort()).toEqual(
      [
        'calendar.create',
        'calendar.delete',
        'files.writeText',
        'folders.createFolder',
        'folders.move',
        'folders.rename',
        'folders.trash'
      ].sort()
    )
    // Everything else in the namespaces that reach the Mac only reads, or only arranges windows.
    const reads = {
      calendar: ['status', 'calendars', 'events'],
      folders: ['places', 'list'],
      files: [
        'search',
        'info',
        'readText',
        'docxHtml',
        'table',
        'thumbnail',
        'open',
        'reveal',
        'restoreLayout',
        'pickFile'
      ]
    }
    for (const [ns, methods] of Object.entries(reads)) {
      const all = [...API_METHODS[ns as keyof typeof reads]] as string[]
      const writes = all.filter((m) => !methods.includes(m)).map((m) => `${ns}.${m}`)
      expect(
        writes.every((w) => changesMac.includes(w)),
        ns
      ).toBe(true)
    }
  })

  it('installs updates only from the everyday window', () => {
    for (const access of Object.values(API_ACCESS.updates))
      expect(access.roles).toEqual(['launcher'])
    expect(methodsFor('vault').updates).toBeUndefined()
    expect(methodsFor('stage').updates).toBeUndefined()
  })
})

describe('change audiences', () => {
  it('names an audience for every change, and keeps vault data changes out of other windows', () => {
    for (const name of CHANGE_NAMES) expect(CHANGE_AUDIENCE[name], name).toBeDefined()
    // The ones that are not vault-only are each a deliberate decision: settings are public, the
    // names-only roster copy exists to be read by the everyday window, a folder change carries no
    // path, the desktop arrangement is the everyday window's own, the teacher chose to have the
    // calendar there too, and updates are installed from the everyday window's Settings.
    const notVaultOnly = [
      'settings.changed',
      'directory.changed',
      'folders.changed',
      'desk.changed',
      'calendar.changed',
      'updates.changed'
    ]
    for (const name of CHANGE_NAMES) {
      if (notVaultOnly.includes(name)) continue
      expect(CHANGE_AUDIENCE[name], name).toEqual(['vault'])
    }
    expect(CHANGE_AUDIENCE['settings.changed']).toContain('launcher')
    expect(CHANGE_AUDIENCE['settings.changed']).not.toContain('stage')
    expect(CHANGE_AUDIENCE['directory.changed']).toEqual(['launcher'])
    expect(CHANGE_AUDIENCE['desk.changed']).toEqual(['launcher'])
    expect(CHANGE_AUDIENCE['updates.changed']).toEqual(['launcher'])
    for (const name of notVaultOnly)
      expect(CHANGE_AUDIENCE[name as 'desk.changed']).not.toContain('stage')
  })

  it('keeps the desktop arrangement in the everyday window and the stage away from the Mac', () => {
    expect(methodsFor('vault').desk).toBeUndefined()
    expect(methodsFor('stage').desk).toBeUndefined()
    expect(methodsFor('stage').folders).toBeUndefined()
    expect(methodsFor('stage').calendar).toBeUndefined()
  })

  it('lets the launcher read the names-only roster copy and nothing more, even with the Vault locked', () => {
    expect(methodsFor('launcher').directory).toEqual(['classes', 'students'])
    for (const m of ['classes', 'students']) {
      const access = API_ACCESS.directory[m as 'classes' | 'students']
      expect(access.roles).toEqual(['launcher'])
      expect((access as { needsVault?: boolean }).needsVault).toBeUndefined()
    }
    // The vault window has the real roster, and the stage can reach none of it.
    expect(methodsFor('vault').directory).toBeUndefined()
    expect(methodsFor('stage').directory).toBeUndefined()
  })
})
