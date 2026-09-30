import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { DISPLAY_OFFER_CHANNEL } from '@shared/events'
import {
  PRESENTATION_ACCELERATOR,
  PRESENTATION_MENU_ID,
  buildMenuTemplate
} from '../../src/main/menu'
import { createNotifier, type Notice } from '../../src/main/notifier'
import { createPresentationService, type ScreenLike } from '../../src/main/presentation'

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

class FakeScreen extends EventEmitter {
  displays: { internal?: boolean }[]
  constructor(displays: { internal?: boolean }[] = [{ internal: true }]) {
    super()
    this.displays = displays
  }
  getAllDisplays() {
    return this.displays
  }
}

function service(over: { screen?: FakeScreen; offerEnabled?: boolean } = {}) {
  const screen = over.screen ?? new FakeScreen()
  const sent: { channel: string; payload: unknown }[] = []
  const changes: boolean[] = []
  const notifications: Notice[] = []
  const notifier = createNotifier({ show: (n) => notifications.push(n) })
  const svc = createPresentationService({
    screen: screen as unknown as ScreenLike,
    notifier,
    offerEnabled: () => over.offerEnabled ?? true,
    send: (channel, payload) => sent.push({ channel, payload }),
    onActiveChange: (on) => changes.push(on)
  })
  return { svc, screen, sent, changes, notifications, notifier }
}

describe('presentation service', () => {
  it('offers presentation mode when an external display is added', () => {
    const { screen, sent } = service()
    screen.emit('display-added', {}, { internal: false })
    expect(sent).toEqual([{ channel: DISPLAY_OFFER_CHANNEL, payload: { reason: 'connected' } }])
  })

  it('does not offer for a built-in display, when already presenting, or when the setting is off', () => {
    const a = service()
    a.screen.emit('display-added', {}, { internal: true })
    expect(a.sent).toEqual([])

    const b = service()
    b.svc.setActive(true)
    b.screen.emit('display-added', {}, { internal: false })
    expect(b.sent).toEqual([])

    const c = service({ offerEnabled: false })
    c.screen.emit('display-added', {}, { internal: false })
    expect(c.sent).toEqual([])
  })

  it('reads the setting each time, so changing it takes effect without a restart', () => {
    let enabled = false
    const screen = new FakeScreen()
    const sent: unknown[] = []
    createPresentationService({
      screen: screen as unknown as ScreenLike,
      notifier: createNotifier({ show: () => undefined }),
      offerEnabled: () => enabled,
      send: (_c, p) => sent.push(p)
    })
    screen.emit('display-added', {}, { internal: false })
    enabled = true
    screen.emit('display-added', {}, { internal: false })
    expect(sent).toHaveLength(1)
  })

  it('counts external displays only when more than one display is present', () => {
    expect(service({ screen: new FakeScreen([{ internal: true }]) }).svc.externalDisplays()).toBe(0)
    expect(
      service({
        screen: new FakeScreen([{ internal: true }, { internal: false }])
      }).svc.externalDisplays()
    ).toBe(1)
    // A lone external monitor (desktop Mac) is the only display, so there is nothing to project to.
    expect(service({ screen: new FakeScreen([{ internal: false }]) }).svc.externalDisplays()).toBe(
      0
    )
  })

  it('reports state changes once, and holds notifications while active', () => {
    const { svc, changes, notifier, notifications } = service()
    svc.setActive(true)
    svc.setActive(true)
    expect(changes).toEqual([true])
    notifier.notify({ title: 'Backup failed', body: '' })
    expect(notifications).toEqual([])
    svc.setActive(false)
    expect(changes).toEqual([true, false])
    expect(notifications).toHaveLength(1)
  })

  it('stops listening when disposed', () => {
    const { svc, screen, sent } = service()
    svc.dispose()
    screen.emit('display-added', {}, { internal: false })
    expect(sent).toEqual([])
    expect(screen.listenerCount('display-added')).toBe(0)
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
