#!/usr/bin/env node
// Stands in for `osascript` in automated runs (the smoke test sets TEACHING_OS_BIN_OSASCRIPT to this
// file), so the Calendar app can be driven without a Mac or a real calendar, and CI never waits on
// macOS's permission prompt. It answers the EventKit script's commands from a JSON file named by
// TOS_FAKE_CALENDAR (created on first use) and answers anything else (window snapping) with nothing.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const file = process.env.TOS_FAKE_CALENDAR
const isCalendar = args[0] === '-l' && args[1] === 'JavaScript' && args[3]?.includes('EventKit')
if (!isCalendar || !file) {
  process.stdout.write('')
  process.exit(0)
}

const [cmd, raw] = args.slice(4)
const input = raw ? JSON.parse(raw) : {}
const state = existsSync(file)
  ? JSON.parse(readFileSync(file, 'utf8'))
  : {
      calendars: [
        { id: 'work', title: 'Work', color: '#4c8dff', source: 'iCloud', writable: true },
        { id: 'holidays', title: 'Holidays', color: '#4cc38a', source: 'Other', writable: false }
      ],
      events: [],
      next: 1
    }
const reply = (value) => {
  writeFileSync(file, JSON.stringify(state))
  process.stdout.write(JSON.stringify(value) + '\n')
}

if (cmd === 'status') reply({ ok: true })
else if (cmd === 'calendars') reply({ ok: true, value: state.calendars })
else if (cmd === 'events')
  reply({
    ok: true,
    value: state.events.filter((e) => e.start < input.to && e.end > input.from)
  })
else if (cmd === 'create') {
  const event = {
    id: `E${state.next++}`,
    calendarId: input.calendarId,
    title: input.title,
    start: input.start,
    end: input.end,
    allDay: !!input.allDay,
    location: input.location ?? '',
    recurring: false
  }
  state.events.push(event)
  reply({ ok: true, value: event })
} else if (cmd === 'delete') {
  const before = state.events.length
  state.events = state.events.filter((e) => !(e.id === input.id && e.start === input.start))
  reply(before === state.events.length ? { ok: false, error: 'gone' } : { ok: true })
} else reply({ ok: false, error: 'unknown' })
