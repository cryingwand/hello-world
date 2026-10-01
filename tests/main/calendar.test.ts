import { describe, expect, it } from 'vitest'
import { EVENTKIT_SCRIPT, createCalendar } from '../../src/main/mac/calendar'
import type { Exec } from '../../src/main/mac/exec'

function fake(reply: (args: string[]) => unknown, mac = true) {
  const calls: string[][] = []
  const changes: string[] = []
  const exec: Exec = async (cmd, args) => {
    calls.push([cmd, ...args])
    const r = reply(args)
    if (r instanceof Error) throw r
    return { stdout: typeof r === 'string' ? r : JSON.stringify(r), stderr: '' }
  }
  const cal = createCalendar({ exec, isMac: () => mac, changed: () => changes.push('changed') })
  return { cal, calls, changes }
}

const ev = {
  id: 'E1',
  calendarId: 'C1',
  title: 'PHIL 101',
  start: 1_790_000_000_000,
  end: 1_790_004_500_000,
  allDay: false,
  location: 'Room 4',
  recurring: true
}

describe('the Mac calendar bridge', () => {
  it('is a script that parses, with no teacher text in it', () => {
    // The ObjC bridge only exists inside osascript; compiling is enough to catch a syntax slip.
    expect(() => new Function(EVENTKIT_SCRIPT)).not.toThrow()
  })

  it('runs the fixed script with the command and its data as separate arguments', async () => {
    const { cal, calls } = fake(() => ({ ok: true, value: [ev] }))
    const from = Date.UTC(2026, 9, 5)
    await cal.events(from, from + 7 * 86_400_000)
    const [cmd, ...args] = calls[0]
    expect(cmd).toBe('osascript')
    expect(args.slice(0, 4)).toEqual(['-l', 'JavaScript', '-e', EVENTKIT_SCRIPT])
    expect(args[4]).toBe('events')
    expect(JSON.parse(args[5])).toEqual({ from, to: from + 7 * 86_400_000 })
  })

  it('keeps what the teacher typed out of the script, even when it looks like code', async () => {
    const { cal, calls, changes } = fake(() => ({ ok: true, value: ev }))
    const title = "'); doShellScript('rm -rf ~'); ('"
    await cal.create({ calendarId: 'C1', title, start: ev.start, end: ev.end })
    expect(calls[0][4]).toBe(EVENTKIT_SCRIPT)
    expect(JSON.parse(calls[0][6]).title).toBe(title)
    expect(changes).toEqual(['changed'])
  })

  it('checks what it is given before asking Calendar', async () => {
    const { cal, calls } = fake(() => ({ ok: true, value: [] }))
    await expect(cal.events(10, 5)).rejects.toThrow(/after the start/)
    await expect(cal.events(0, 63 * 86_400_000)).rejects.toThrow(/at most 62 days/)
    await expect(cal.create({ calendarId: 'C1', title: ' ', start: 1, end: 2 })).rejects.toThrow(
      /Title is required/
    )
    await expect(cal.create({ calendarId: 'C1', title: 'x', start: 5, end: 1 })).rejects.toThrow(
      /after the start/
    )
    await expect(cal.delete('', 1)).rejects.toThrow(/required/)
    expect(calls).toEqual([])
  })

  it('says how to allow access when macOS has not given it', async () => {
    const { cal } = fake(() => ({ ok: false, error: 'denied' }))
    expect(await cal.status()).toMatchObject({ access: 'denied', message: /Privacy & Security/ })
    await expect(cal.calendars()).rejects.toThrow(/Privacy & Security/)
  })

  it('is unavailable away from a Mac, without running anything', async () => {
    const { cal, calls } = fake(() => ({ ok: true }), false)
    expect(await cal.status()).toEqual({ access: 'unavailable', message: expect.any(String) })
    await expect(cal.calendars()).rejects.toThrow(/Mac only/)
    expect(calls).toEqual([])
  })

  it('reports a failed or garbled run as a readable error', async () => {
    await expect(fake(() => new Error('boom')).cal.calendars()).rejects.toThrow(
      /could not be reached/
    )
    await expect(fake(() => 'not json').cal.calendars()).rejects.toThrow(/unexpected/)
    await expect(fake(() => ({ ok: false, error: 'gone' })).cal.delete('E1', 1)).rejects.toThrow(
      /no longer in your calendar/
    )
  })

  it('sorts events by start time', async () => {
    const later = { ...ev, id: 'E2', start: ev.start + 1000 }
    const { cal } = fake(() => ({ ok: true, value: [later, ev] }))
    expect((await cal.events(ev.start - 1, ev.start + 86_400_000)).map((e) => e.id)).toEqual([
      'E1',
      'E2'
    ])
  })
})
