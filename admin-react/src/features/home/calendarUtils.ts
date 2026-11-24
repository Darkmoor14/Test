// Calendar event model + whole-series recurrence math, ported 1:1 from
// admin-core.js (see that file's "RECURRING EVENTS" comment block for the
// full rationale) -- a recurring row's own start_time is occurrence #1,
// every later occurrence is computed virtually at render time, never
// persisted as its own row. Editing/deleting the row edits/deletes the
// whole series.

import { pad2 } from '../../lib/format';

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceEndType = 'date' | 'count' | 'never';

export interface RecurrencePattern {
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  recurrence_days_of_week: number[] | null;
  recurrence_end_type: RecurrenceEndType;
  recurrence_end_date: string | null;
  recurrence_count: number | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  reminder_minutes_before: number | null;
  reminder_sent_at: string | null;
  recurrence_freq: RecurrenceFreq | null;
  recurrence_interval: number | null;
  recurrence_days_of_week: number[] | null;
  recurrence_end_type: RecurrenceEndType | null;
  recurrence_end_date: string | null;
  recurrence_count: number | null;
  attendees: string[] | null;
  created_by: string | null;
  travel_time_minutes: number | null;
  url: string | null;
  is_recurring_occurrence?: boolean;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay(); // Monday=1..Sunday=7
}

export function mondayOfWeek(d: Date): Date {
  const wd = isoWeekday(d);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (wd - 1));
}

// Walks day-by-day from the series' own start date rather than a
// closed-form formula per frequency -- correct for irregular patterns
// (weekly on several weekdays at once) without risking a subtle off-by-one,
// and cheap enough at calendar-UI scale (bounded to 10 years).
export function getRecurrenceOccurrenceDates(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): Date[] {
  if (!event.recurrence_freq || !event.start_time) return [];
  const seriesStart = new Date(event.start_time);
  const cursor0 = new Date(seriesStart.getFullYear(), seriesStart.getMonth(), seriesStart.getDate());
  const hardStop = new Date(cursor0.getTime() + 10 * 365 * 86400000);
  const endDate = event.recurrence_end_type === 'date' && event.recurrence_end_date
    ? new Date(event.recurrence_end_date + 'T00:00:00')
    : null;
  const maxCount = event.recurrence_end_type === 'count' ? (event.recurrence_count || 0) : Infinity;
  const interval = Math.max(1, event.recurrence_interval || 1);
  const weeklyDays = event.recurrence_freq === 'weekly'
    ? (event.recurrence_days_of_week && event.recurrence_days_of_week.length ? event.recurrence_days_of_week : [isoWeekday(cursor0)])
    : null;
  const seriesWeekStart = event.recurrence_freq === 'weekly' ? mondayOfWeek(cursor0) : null;

  const results: Date[] = [];
  let occurrenceCount = 0;
  let d = new Date(cursor0);
  while (d <= hardStop && d <= rangeEnd) {
    if (endDate && d > endDate) break;
    if (occurrenceCount >= maxCount) break;
    let matches = false;
    if (event.recurrence_freq === 'daily') {
      const diffDays = Math.round((d.getTime() - cursor0.getTime()) / 86400000);
      matches = diffDays % interval === 0;
    } else if (event.recurrence_freq === 'weekly') {
      if (weeklyDays!.includes(isoWeekday(d))) {
        const weekStart = mondayOfWeek(d);
        const diffWeeks = Math.round((weekStart.getTime() - seriesWeekStart!.getTime()) / (7 * 86400000));
        matches = diffWeeks >= 0 && diffWeeks % interval === 0;
      }
    } else if (event.recurrence_freq === 'monthly') {
      matches = d >= cursor0 && d.getDate() === cursor0.getDate()
        && ((d.getFullYear() - cursor0.getFullYear()) * 12 + (d.getMonth() - cursor0.getMonth())) % interval === 0;
    } else if (event.recurrence_freq === 'yearly') {
      matches = d >= cursor0 && d.getDate() === cursor0.getDate() && d.getMonth() === cursor0.getMonth()
        && (d.getFullYear() - cursor0.getFullYear()) % interval === 0;
    }
    if (matches) {
      occurrenceCount++;
      if (d >= rangeStart) results.push(new Date(d));
    }
    d = new Date(d.getTime() + 86400000);
  }
  return results;
}

// Builds a display-only virtual occurrence: same id/title/description/
// location/reminder/attendees as the series row, with start_time/end_time
// shifted onto the given occurrence date (same time-of-day and duration as
// the series' own first occurrence).
export function buildOccurrenceEvent(event: CalendarEvent, occurrenceDate: Date): CalendarEvent {
  const masterStart = new Date(event.start_time);
  const start = new Date(occurrenceDate.getFullYear(), occurrenceDate.getMonth(), occurrenceDate.getDate(), masterStart.getHours(), masterStart.getMinutes());
  let end: Date | null = null;
  if (event.end_time) {
    const durationMs = new Date(event.end_time).getTime() - masterStart.getTime();
    end = new Date(start.getTime() + durationMs);
  }
  return { ...event, start_time: start.toISOString(), end_time: end ? end.toISOString() : null, is_recurring_occurrence: true };
}

// Same recurrence-aware matching as eventsOnDate, but for an entire
// visible grid (e.g. a full month view's 5-6 weeks) in one pass rather
// than calling eventsOnDate per cell, which would re-walk every
// recurring series once per day shown instead of once total.
export function eventsByDateInRange(calendarEvents: CalendarEvent[], rangeStart: Date, rangeEnd: Date): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  const push = (key: string, e: CalendarEvent) => {
    const arr = map.get(key);
    if (arr) arr.push(e); else map.set(key, [e]);
  };
  for (const e of calendarEvents) {
    if (!e.start_time) continue;
    if (e.recurrence_freq) {
      for (const d of getRecurrenceOccurrenceDates(e, rangeStart, rangeEnd)) {
        push(dateKey(d), buildOccurrenceEvent(e, d));
      }
    } else {
      const startDay = new Date(new Date(e.start_time).getFullYear(), new Date(e.start_time).getMonth(), new Date(e.start_time).getDate());
      const endDay = e.end_time
        ? new Date(new Date(e.end_time).getFullYear(), new Date(e.end_time).getMonth(), new Date(e.end_time).getDate())
        : startDay;
      let cursor = new Date(Math.max(startDay.getTime(), rangeStart.getTime()));
      const stopAt = new Date(Math.min(endDay.getTime(), rangeEnd.getTime()));
      while (cursor <= stopAt) {
        push(dateKey(cursor), e);
        cursor = new Date(cursor.getTime() + 86400000);
      }
    }
  }
  for (const arr of map.values()) arr.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  return map;
}

// An event with no invitees is a private, personal-calendar entry --
// only its creator sees it anywhere (mini calendar, full month view,
// day sheets, De făcut, the Apple Calendar feed). Adding invitees
// shares it with exactly those people plus the creator; it never
// becomes visible to staff at large just by having invitees.
export function isEventVisibleTo(e: CalendarEvent, email: string | null): boolean {
  if (!email) return false;
  if (e.created_by === email) return true;
  return Array.isArray(e.attendees) && e.attendees.includes(email);
}

export function eventsOnDate(calendarEvents: CalendarEvent[], dateKeyStr: string): CalendarEvent[] {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const targetDate = new Date(y, m - 1, d);
  // end_time can now land on a later calendar day than start_time (a
  // real "Ends" date/time, not a same-day duration) -- an event occupies
  // every day in [startDay, endDay] inclusive, not just its start day.
  const direct = calendarEvents.filter((e) => {
    if (!e.start_time || e.recurrence_freq) return false;
    const startKey = dateKey(new Date(e.start_time));
    const endKey = e.end_time ? dateKey(new Date(e.end_time)) : startKey;
    return dateKeyStr >= startKey && dateKeyStr <= endKey;
  });
  const recurring = calendarEvents
    .filter((e) => e.recurrence_freq && getRecurrenceOccurrenceDates(e, targetDate, targetDate).length > 0)
    .map((e) => buildOccurrenceEvent(e, targetDate));
  return [...direct, ...recurring].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

export const RECUR_INTERVAL_UNITS: Record<RecurrenceFreq, (n: number) => string> = {
  daily: (n) => (n === 1 ? 'zi' : 'zile'),
  weekly: (n) => (n === 1 ? 'săptămână' : 'săptămâni'),
  monthly: (n) => (n === 1 ? 'lună' : 'luni'),
  yearly: (n) => (n === 1 ? 'an' : 'ani'),
};
export const RECUR_FREQ_LABELS: Record<RecurrenceFreq, string> = { daily: 'zilnic', weekly: 'săptămânal', monthly: 'lunar', yearly: 'anual' };
export const WEEKDAY_SHORT_NAMES: Record<number, string> = { 1: 'L', 2: 'Ma', 3: 'Mi', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };

export function describeRecurrence(r: RecurrencePattern | null): string {
  if (!r) return '🔁 Nu se repetă';
  let desc = `🔁 Se repetă ${RECUR_FREQ_LABELS[r.recurrence_freq]}`;
  if ((r.recurrence_interval || 1) > 1) {
    desc = `🔁 La fiecare ${r.recurrence_interval} ${RECUR_INTERVAL_UNITS[r.recurrence_freq](r.recurrence_interval)}`;
  }
  if (r.recurrence_freq === 'weekly' && r.recurrence_days_of_week && r.recurrence_days_of_week.length) {
    desc += ' (' + r.recurrence_days_of_week.slice().sort().map((d) => WEEKDAY_SHORT_NAMES[d]).join(', ') + ')';
  }
  return desc;
}

export const HOME_CLOCK_MONTH_NAMES = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
export const HOME_CLOCK_DAY_NAMES = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];

// An event with no explicit end_time still counts as "happening now" for a
// 10-minute grace period past its start.
const EVENT_ACTIVE_GRACE_MS = 10 * 60 * 1000;
export function isEventHappeningNow(e: CalendarEvent, now: Date): boolean {
  if (!e.start_time) return false;
  const start = new Date(e.start_time);
  const end = e.end_time ? new Date(e.end_time) : new Date(start.getTime() + EVENT_ACTIVE_GRACE_MS);
  return now >= start && now <= end;
}

// ===== Single-event .ics export (invite-by-email "share" button) =====
// Same RFC5545 formatting rules as supabase/functions/calendar-feed
// (the Apple Calendar subscription feed), ported here rather than
// shared as a module -- that one runs in Deno, this runs in the
// browser, and they don't share a build pipeline. Works on an
// in-progress draft (no id yet, nothing saved) since it only needs the
// same fields CalendarEventInput already carries, not a saved row.
export interface IcsEventInput {
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  reminder_minutes_before: number | null;
  travel_time_minutes: number | null;
  recurrence_freq: RecurrenceFreq | null;
  recurrence_interval: number | null;
  recurrence_days_of_week: number[] | null;
  recurrence_end_type: RecurrenceEndType | null;
  recurrence_end_date: string | null;
  recurrence_count: number | null;
  // A saved event's own id, so the UID matches both what the Apple
  // Calendar feed would use for it (${id}@insta-grup.ro) and any later
  // cancellation notice for the same event -- without this, a calendar
  // app has no way to tell a CANCEL apart from an unrelated new event.
  // Omitted for an unsaved draft (nothing to match yet); a random UID
  // is generated for that case.
  id?: string;
  // A cancellation notice re-sends the same event as CANCELLED instead
  // of PUBLISH/CONFIRMED -- calendar apps that kept the original
  // (matched by the same UID above) remove or grey it out on import.
  cancelled?: boolean;
}

function icsFormatUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

// All-day dates are read back in Europe/Bucharest, not naive UTC --
// Bucharest is ahead of UTC, so the UTC date of a Bucharest midnight
// instant is the day before.
function icsBucharestDateDigits(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}${get('month')}${get('day')}`;
}
function icsAddDaysToDateDigits(digits: string, days: number): string {
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}`;
}
function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsFoldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    chunks.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return chunks.join('\r\n');
}
const ICS_DAY_CODES: Record<number, string> = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' };
const ICS_FREQ_CODES: Record<RecurrenceFreq, string> = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };

function icsBuildRRule(e: IcsEventInput): string | null {
  if (!e.recurrence_freq) return null;
  const parts = [`FREQ=${ICS_FREQ_CODES[e.recurrence_freq]}`];
  if (e.recurrence_interval && e.recurrence_interval > 1) parts.push(`INTERVAL=${e.recurrence_interval}`);
  if (e.recurrence_freq === 'weekly' && e.recurrence_days_of_week?.length) {
    parts.push(`BYDAY=${e.recurrence_days_of_week.map((d) => ICS_DAY_CODES[d]).filter(Boolean).join(',')}`);
  }
  if (e.recurrence_end_type === 'date' && e.recurrence_end_date) {
    parts.push(`UNTIL=${icsFormatUtc(new Date(`${e.recurrence_end_date}T23:59:59Z`))}`);
  } else if (e.recurrence_end_type === 'count' && e.recurrence_count) {
    parts.push(`COUNT=${e.recurrence_count}`);
  }
  return parts.join(';');
}

export function buildEventIcs(e: IcsEventInput): string {
  const method = e.cancelled ? 'CANCEL' : 'PUBLISH';
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Insta Grup//Calendar Acasa//RO', 'CALSCALE:GREGORIAN', `METHOD:${method}`];
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${e.id ? `${e.id}@insta-grup.ro` : `${Date.now()}-${Math.random().toString(36).slice(2)}@insta-grup.ro`}`);
  lines.push(`DTSTAMP:${icsFormatUtc(new Date())}`);
  // A cancellation has to outrank the original invite's sequence number
  // for calendar apps to treat it as superseding (not just a duplicate)
  // -- there's only ever at most one re-send in this flow, so 0/1 is
  // enough without persisting a real counter per event.
  lines.push(`SEQUENCE:${e.cancelled ? '1' : '0'}`);

  if (e.all_day) {
    const startDigits = icsBucharestDateDigits(e.start_time);
    const endDigits = icsBucharestDateDigits(e.end_time || e.start_time);
    lines.push(`DTSTART;VALUE=DATE:${startDigits}`);
    lines.push(`DTEND;VALUE=DATE:${icsAddDaysToDateDigits(endDigits, 1)}`);
  } else {
    lines.push(`DTSTART:${icsFormatUtc(new Date(e.start_time))}`);
    lines.push(`DTEND:${icsFormatUtc(new Date(e.end_time || e.start_time))}`);
  }

  lines.push(icsFoldLine(`SUMMARY:${icsEscape(e.title || '(fără titlu)')}`));
  if (e.location) lines.push(icsFoldLine(`LOCATION:${icsEscape(e.location)}`));
  if (e.url) lines.push(icsFoldLine(`URL:${e.url.replace(/\r?\n/g, '')}`));
  if (e.description) lines.push(icsFoldLine(`DESCRIPTION:${icsEscape(e.description)}`));

  const rrule = icsBuildRRule(e);
  if (rrule) lines.push(`RRULE:${rrule}`);

  // Alarms are meaningless on a cancelled event -- nobody needs a
  // reminder or a travel-time alert for something that's off.
  if (!e.cancelled) {
    if (e.reminder_minutes_before) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', icsFoldLine(`DESCRIPTION:${icsEscape(e.title || 'Memento')}`), `TRIGGER:-PT${e.reminder_minutes_before}M`, 'END:VALARM');
    }
    if (e.travel_time_minutes) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Timp de deplasare', `TRIGGER:-PT${e.travel_time_minutes + (e.reminder_minutes_before || 0)}M`, 'END:VALARM');
    }
  }

  lines.push(`STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
