import {
  MAX_RANGE_DAYS,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarInfo,
  type CalendarStatus
} from '@shared/calendar'
import { ValidationError } from '../validate'
import type { Exec } from './exec'

/**
 * EventKit, driven from JavaScript for Automation. EventKit is the framework Calendar itself uses: it
 * sees every account added to the Mac and expands repeating events into their dates, which scripting
 * the Calendar app cannot do. The script is fixed; what changes travels as one JSON argument, so
 * nothing the teacher types is ever part of the script.
 *
 * The first call asks for Calendar access (macOS shows its own prompt, naming Teaching OS). Authorization
 * status 3 is full access; 4 (write-only, macOS 14+) cannot read and counts as denied.
 */
export const EVENTKIT_SCRIPT = String.raw`
ObjC.import('EventKit');
ObjC.import('AppKit');
function str(v) { return v && !v.isNil() ? ObjC.unwrap(v) : ''; }
function hex(color) {
  try {
    var c = color.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
    var h = function (x) { var s = Math.round(x * 255).toString(16); return s.length < 2 ? '0' + s : s; };
    return '#' + h(c.redComponent) + h(c.greenComponent) + h(c.blueComponent);
  } catch (e) { return '#8a94a6'; }
}
function date(ms) { return $.NSDate.dateWithTimeIntervalSince1970(ms / 1000); }
function ms(d) { return Math.round(d.timeIntervalSince1970 * 1000); }
function access(store) {
  var status = $.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent);
  if (status === 0) {
    var done = false;
    var cb = function (granted, error) { done = true; };
    if (store.respondsToSelector('requestFullAccessToEventsWithCompletion:')) {
      store.requestFullAccessToEventsWithCompletion(cb);
    } else {
      store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, cb);
    }
    var until = $.NSDate.dateWithTimeIntervalSinceNow(120);
    while (!done && $.NSDate.date.compare(until) < 0) {
      $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
    }
    status = $.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent);
  }
  return status === 3;
}
function calendars(store) {
  return store.calendarsForEntityType($.EKEntityTypeEvent);
}
function eventJson(e) {
  return {
    id: str(e.eventIdentifier),
    calendarId: str(e.calendar.calendarIdentifier),
    title: str(e.title),
    start: ms(e.startDate),
    end: ms(e.endDate),
    allDay: !!e.isAllDay,
    location: str(e.location),
    recurring: !!e.hasRecurrenceRules
  };
}
function find(store, id, start) {
  var day = 86400000;
  var list = store.eventsMatchingPredicate(
    store.predicateForEventsWithStartDateEndDateCalendars(date(start - day), date(start + day), calendars(store))
  );
  for (var i = 0; i < list.count; i++) {
    var e = list.objectAtIndex(i);
    if (str(e.eventIdentifier) === id && ms(e.startDate) === start) return e;
  }
  return null;
}
function run(argv) {
  var cmd = argv[0];
  var args = argv.length > 1 ? JSON.parse(argv[1]) : {};
  var store = $.EKEventStore.alloc.init;
  if (!access(store)) return JSON.stringify({ ok: false, error: 'denied' });
  if (cmd === 'status') return JSON.stringify({ ok: true });
  if (cmd === 'calendars') {
    var cals = calendars(store);
    var out = [];
    for (var i = 0; i < cals.count; i++) {
      var c = cals.objectAtIndex(i);
      out.push({
        id: str(c.calendarIdentifier),
        title: str(c.title),
        color: hex(c.color),
        source: c.source && !c.source.isNil() ? str(c.source.title) : '',
        writable: !!c.allowsContentModifications
      });
    }
    return JSON.stringify({ ok: true, value: out });
  }
  if (cmd === 'events') {
    var list = store.eventsMatchingPredicate(
      store.predicateForEventsWithStartDateEndDateCalendars(date(args.from), date(args.to), calendars(store))
    );
    var events = [];
    for (var j = 0; j < list.count; j++) events.push(eventJson(list.objectAtIndex(j)));
    return JSON.stringify({ ok: true, value: events });
  }
  if (cmd === 'create') {
    var cal = store.calendarWithIdentifier(args.calendarId);
    if (!cal || cal.isNil()) return JSON.stringify({ ok: false, error: 'no-calendar' });
    var ev = $.EKEvent.eventWithEventStore(store);
    ev.setTitle(args.title);
    ev.setStartDate(date(args.start));
    ev.setEndDate(date(args.end));
    ev.setAllDay(!!args.allDay);
    if (args.location) ev.setLocation(args.location);
    if (args.notes) ev.setNotes(args.notes);
    ev.setCalendar(cal);
    var err = Ref();
    if (!store.saveEventSpanCommitError(ev, 0, true, err)) return JSON.stringify({ ok: false, error: 'save' });
    return JSON.stringify({ ok: true, value: eventJson(ev) });
  }
  if (cmd === 'delete') {
    var target = find(store, args.id, args.start);
    if (!target) return JSON.stringify({ ok: false, error: 'gone' });
    var err2 = Ref();
    if (!store.removeEventSpanCommitError(target, 0, true, err2)) return JSON.stringify({ ok: false, error: 'save' });
    return JSON.stringify({ ok: true });
  }
  return JSON.stringify({ ok: false, error: 'unknown' });
}
`

const DENIED =
  'Teaching OS cannot see your calendars. Allow it in System Settings › Privacy & Security › Calendars (full access), then try again.'
const NOT_MAC = 'Calendar works on a Mac only.'
const MESSAGES: Record<string, string> = {
  denied: DENIED,
  'no-calendar': 'That calendar is no longer there',
  gone: 'That event is no longer in your calendar',
  save: 'Calendar did not accept the change (the calendar may be read-only)'
}

export interface CalendarDeps {
  exec: Exec
  isMac: () => boolean
  /** Called after an event is added or removed here. */
  changed: () => void
}

const time = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new ValidationError(`${field} must be a time`)
  }
  return Math.round(value)
}
const text = (value: unknown, field: string, max: number, required = false): string => {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} is required`)
    return ''
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`)
  const t = value.trim()
  if (required && t === '') throw new ValidationError(`${field} is required`)
  if (t.length > max) throw new ValidationError(`${field} is too long`)
  return t
}

/** The Mac's calendars. Every call runs the EventKit script once; nothing is cached here. */
export function createCalendar(deps: CalendarDeps) {
  const call = async <T>(cmd: string, args?: object): Promise<T> => {
    if (!deps.isMac()) throw new ValidationError(NOT_MAC)
    let stdout: string
    try {
      ;({ stdout } = await deps.exec(
        'osascript',
        ['-l', 'JavaScript', '-e', EVENTKIT_SCRIPT, cmd, ...(args ? [JSON.stringify(args)] : [])],
        // The first call waits for the teacher to answer the permission prompt.
        { timeoutMs: 150_000 }
      ))
    } catch (err) {
      console.error('[calendar]', cmd, 'failed:', (err as { stderr?: string }).stderr ?? err)
      throw new ValidationError('Calendar could not be reached. Is the Calendar app set up?')
    }
    let res: { ok: boolean; value?: T; error?: string }
    try {
      res = JSON.parse(stdout.trim())
    } catch {
      throw new ValidationError('Calendar sent back something unexpected')
    }
    if (!res.ok) throw new ValidationError(MESSAGES[res.error ?? ''] ?? 'Calendar refused that')
    return res.value as T
  }

  return {
    async status(): Promise<CalendarStatus> {
      if (!deps.isMac()) return { access: 'unavailable', message: NOT_MAC }
      try {
        await call('status')
        return { access: 'granted' }
      } catch (err) {
        return { access: 'denied', message: (err as Error).message }
      }
    },

    calendars: (): Promise<CalendarInfo[]> => call('calendars'),

    async events(rawFrom: number, rawTo: number): Promise<CalendarEvent[]> {
      const from = time(rawFrom, 'From')
      const to = time(rawTo, 'To')
      if (to <= from) throw new ValidationError('The end must be after the start')
      if (to - from > MAX_RANGE_DAYS * 86_400_000) {
        throw new ValidationError(`Ask for at most ${MAX_RANGE_DAYS} days at a time`)
      }
      const list = await call<CalendarEvent[]>('events', { from, to })
      return list.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
    },

    async create(input: CalendarEventInput): Promise<CalendarEvent> {
      const args = {
        calendarId: text(input?.calendarId, 'Calendar', 300, true),
        title: text(input.title, 'Title', 300, true),
        start: time(input.start, 'Start'),
        end: time(input.end, 'End'),
        allDay: input.allDay === true,
        location: text(input.location, 'Location', 300),
        notes: text(input.notes, 'Notes', 5000)
      }
      if (args.end < args.start) throw new ValidationError('The end must be after the start')
      const made = await call<CalendarEvent>('create', args)
      deps.changed()
      return made
    },

    /** One occurrence: for a repeating event, only the one that starts at `start`. */
    async delete(id: string, start: number): Promise<void> {
      await call('delete', { id: text(id, 'Event', 1000, true), start: time(start, 'Start') })
      deps.changed()
    }
  }
}

export type MacCalendar = ReturnType<typeof createCalendar>
