// Calendar event model + whole-series recurrence math, ported 1:1 from
// admin-core.js (see that file's "RECURRING EVENTS" comment block for the
// full rationale) -- a recurring row's own start_time is occurrence #1,
// every later occurrence is computed virtually at render time, never
// persisted as its own row. Editing/deleting the row edits/deletes the
// whole series.

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
