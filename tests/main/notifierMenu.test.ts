import { describe, expect, it } from 'vitest'
import {
  PRESENTATION_ACCELERATOR,
  PRESENTATION_MENU_ID,
  buildMenuTemplate
} from '../../src/main/menu'
import { createNotifier, type Notice } from '../../src/main/notifier'

describe('notifier', () => {
  const make = () => {
    const shown: Notice[] = []
    return { shown, n: createNotifier({ show: (x) => shown.push(x) }) }
  }

  it('shows notifications straight away when not presenting', () => {
    const { shown, n } = make()
    n.notify({ title: 'Backup failed', body: 'disk full' })
    expect(shown).toEqual([{ title: 'Backup failed', body: 'disk full' }])
  })

  it('holds them while presenting and shows one summary afterwards', () => {
    const { shown, n } = make()
    n.setPresenting(true)
    n.notify({ title: 'A', body: 'one' })
    n.notify({ title: 'B', body: 'two' })
    expect(shown).toEqual([])
    expect(n.heldCount()).toBe(2)
    n.setPresenting(false)
    expect(shown).toHaveLength(1)
    expect(shown[0].title).toMatch(/2 notifications while you were presenting/)
    expect(shown[0].body).toBe('A: one\nB: two')
    expect(n.heldCount()).toBe(0)
  })

  it('shows a single held notification as itself', () => {
    const { shown, n } = make()
    n.setPresenting(true)
    n.notify({ title: 'Backup failed', body: 'x' })
    n.setPresenting(false)
    expect(shown).toEqual([{ title: 'Backup failed', body: 'x' }])
  })

  it('shows nothing when nothing was held, and is not confused by repeated toggles', () => {
    const { shown, n } = make()
    n.setPresenting(true)
    n.setPresenting(true)
    n.setPresenting(false)
    n.setPresenting(false)
    expect(shown).toEqual([])
  })

  it('keeps only the most recent held notifications', () => {
    const shown: Notice[] = []
    const n = createNotifier({ show: (x) => shown.push(x), maxHeld: 3 })
    n.setPresenting(true)
    for (let i = 0; i < 6; i++) n.notify({ title: `t${i}`, body: '' })
    n.setPresenting(false)
    expect(shown[0].body).toBe('t3: \nt4: \nt5: ')
  })

  it('does not replay old notifications on the next presentation', () => {
    const { shown, n } = make()
    n.setPresenting(true)
    n.notify({ title: 'once', body: '' })
    n.setPresenting(false)
    shown.length = 0
    n.setPresenting(true)
    n.setPresenting(false)
    expect(shown).toEqual([])
  })
})

describe('menu template', () => {
  const build = (over: Partial<Parameters<typeof buildMenuTemplate>[0]> = {}) => {
    let toggled = 0
    const t = buildMenuTemplate({
      appName: 'Teaching OS',
      isMac: true,
      isPackaged: true,
      presenting: false,
      onTogglePresentation: () => toggled++,
      ...over
    })
    const view = t.find((m) => m.label === 'View')!
    const item = (
      view.submenu as { id?: string; accelerator?: string; checked?: boolean; click?: () => void }[]
    ).find((i) => i.id === PRESENTATION_MENU_ID)!
    return { t, view, item, toggled: () => toggled }
  }

  it('has a presentation item with the hotkey that calls back when clicked', () => {
    const { item, toggled } = build()
    expect(item.accelerator).toBe(PRESENTATION_ACCELERATOR)
    expect(PRESENTATION_ACCELERATOR).toBe('CommandOrControl+Shift+P')
    item.click!()
    expect(toggled()).toBe(1)
  })

  it('reflects the current state in the checkbox', () => {
    expect(build({ presenting: true }).item.checked).toBe(true)
    expect(build({ presenting: false }).item.checked).toBe(false)
  })

  it('includes an Edit menu (copy and paste in text fields need it on a Mac) and the app menu only on macOS', () => {
    const mac = build({ isMac: true }).t
    const other = build({ isMac: false }).t
    expect(mac.some((m) => m.role === 'appMenu')).toBe(true)
    expect(other.some((m) => m.role === 'appMenu')).toBe(false)
    expect(mac.some((m) => m.role === 'editMenu')).toBe(true)
  })

  it('leaves developer tools out of a packaged app but keeps them for development', () => {
    const roles = (t: ReturnType<typeof build>) =>
      (t.view.submenu as { role?: string }[]).map((i) => i.role)
    expect(roles(build({ isPackaged: true }))).not.toContain('toggleDevTools')
    expect(roles(build({ isPackaged: false }))).toContain('toggleDevTools')
  })
})
