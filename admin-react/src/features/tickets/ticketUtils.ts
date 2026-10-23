import type { OverviewCardFilterKey, StatusFilterKey, Ticket } from './types';

// Some historical tickets have submitted_on/resolved_on stored with a
// 2-digit year (someone typed "26" instead of "2026") -- a perfectly
// VALID JS Date (year 26 AD) that never trips isNaN, but sorts/filters
// nowhere near where it should. Every ticket in this system is from the
// 2000s, so correcting a sub-100 year by +2000 is safe. Used everywhere
// a ticket date gets parsed (filtering, sorting, aging, charts, display).
export function parseTicketDate(dateStr: string | null | undefined): Date {
  const d = new Date(dateStr || '');
  if (isNaN(d.getTime())) return d;
  if (d.getFullYear() < 100) d.setFullYear(d.getFullYear() + 2000);
  return d;
}

export function normalizeYearInDateValue(val: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val || '');
  if (!m) return val;
  const year = parseInt(m[1], 10);
  if (year >= 100) return val;
  return String(year + 2000).padStart(4, '0') + '-' + m[2] + '-' + m[3];
}

export function hasSuspiciousYear(val: string): boolean {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(val || '');
  if (!m) return false;
  const year = parseInt(m[1], 10);
  return year < 1900 || year > new Date().getFullYear() + 1;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parseTicketDate(iso);
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export const fmtDateOnly = fmtDate;

export function toDateTimeInputParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = parseTicketDate(iso);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function combineDateTimeToISO(dateStr: string, timeStr?: string): string {
  if (!dateStr) return new Date().toISOString();
  const nowTime = timeStr || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  const d = new Date(`${dateStr}T${nowTime}`);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export function calendarDaysBetween(submittedISO: string, resolvedISO: string): number {
  const submitted = parseTicketDate(submittedISO);
  const resolved = parseTicketDate(resolvedISO);
  const submittedDateOnly = new Date(submitted.getFullYear(), submitted.getMonth(), submitted.getDate());
  const resolvedDateOnly = new Date(resolved.getFullYear(), resolved.getMonth(), resolved.getDate());
  const diffDays = Math.round((resolvedDateOnly.getTime() - submittedDateOnly.getTime()) / 86400000);
  return diffDays + 1;
}

export function formatDays(days: number): string {
  if (!isFinite(days)) return '—';
  const rounded = Math.round(days * 10) / 10;
  return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1)) + (rounded === 1 ? ' zi' : ' zile');
}

export function formatDurationDays(days: number): string {
  if (!isFinite(days) || days < 1) return '—';
  return days === 1 ? '1 zi' : days + ' zile';
}

export const AGING_THRESHOLD_DAYS = 7;

export function isAwaitingReport(t: Ticket): boolean {
  return t.status === 'Terminat' && !t.resolution_note;
}

export function isDuplicateTicket(t: Ticket | null | undefined): boolean {
  return !!(t && t.duplicate_of);
}

export function getDuplicatesOf(tickets: Ticket[], ticketId: string): Ticket[] {
  return tickets.filter((t) => t.duplicate_of === ticketId);
}

export type TicketSource = 'public' | 'autosesizare' | 'politia-locala' | 'biroul-energetic';
export const TICKET_SOURCE_LABELS: Record<TicketSource, string> = {
  public: 'Public',
  autosesizare: 'Autosesizare',
  'politia-locala': 'Poliția locală',
  'biroul-energetic': 'Biroul energetic',
};

// Same diacritics-insensitive matching as excel.js's isWhitelistedReporterName
// (normalizeRomanianText/isWhitelistedReporterName) -- these three
// institutional reporter-name patterns are the only ones ever singled
// out anywhere in the app (also the public-site name whitelist); every
// other ticket counts as an ordinary public report.
function normalizeRomanianText(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[ăâ]/g, 'a')
    .replace(/î/g, 'i')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't');
}

export function classifyTicketSource(t: Ticket): TicketSource {
  const normalized = normalizeRomanianText(t.name);
  if (normalized.includes('politia') && normalized.includes('locala')) return 'politia-locala';
  if (normalized.includes('birou') && normalized.includes('energetic')) return 'biroul-energetic';
  if (normalized.includes('autosesizare')) return 'autosesizare';
  return 'public';
}

export function getCanonicalTicket(tickets: Ticket[], t: Ticket | null | undefined): Ticket | null {
  if (!t || !t.duplicate_of) return null;
  return tickets.find((x) => x.id === t.duplicate_of) || null;
}

// A ticket's "effective" month/year for filtering -- NOT necessarily
// when it was submitted. Still-active tickets always count as the
// CURRENT real-world month so open work never buries itself in a past
// month; once Terminat AND reported, it settles at its real submission
// month. A Terminat ticket still awaiting its report stays pinned to
// the current month too.
export function getEffectiveMonthYear(t: Ticket): { year: number | null; month: number | null } {
  if (t.status !== 'Terminat' || isAwaitingReport(t)) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  if (!t.submitted_on) return { year: null, month: null };
  const d = parseTicketDate(t.submitted_on);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function matchesSearch(t: Ticket, query: string): boolean {
  if (!query) return true;
  const haystack = [t.ticket_number, t.name, t.phone, t.address, t.email].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

// getEffectiveMonthYear's "still-open pins to the current month" rule
// keeps an old-but-unresolved ticket from vanishing off whatever counts
// as "this month" -- whether that's the default, unfiltered ("all")
// view or the real current month explicitly picked from the calendar.
// Picking any OTHER (past or future) month is deliberate historical
// browsing ("what happened in Septembrie", back in, say, October) and
// has to honor the real submission date instead -- otherwise an open
// ticket could only ever show up under today's actual year/month, and
// browsing any other month for an active-only card (Active/Accidente/
// ...) would be structurally guaranteed to show nothing, no matter
// what was actually submitted that month.
export function matchesYear(t: Ticket, yearFilter: string): boolean {
  if (yearFilter === 'all') return true;
  if (String(yearFilter) === String(new Date().getFullYear())) {
    const { year } = getEffectiveMonthYear(t);
    return year !== null && String(year) === String(yearFilter);
  }
  if (!t.submitted_on) return false;
  const d = parseTicketDate(t.submitted_on);
  return !isNaN(d.getTime()) && String(d.getFullYear()) === String(yearFilter);
}

export function matchesMonth(t: Ticket, monthFilter: string): boolean {
  if (monthFilter === 'all') return true;
  if (String(monthFilter) === String(new Date().getMonth() + 1)) {
    const { month } = getEffectiveMonthYear(t);
    return month !== null && String(month) === String(monthFilter);
  }
  if (!t.submitted_on) return false;
  const d = parseTicketDate(t.submitted_on);
  return !isNaN(d.getTime()) && String(d.getMonth() + 1) === String(monthFilter);
}

// Urgent/accident tickets that are still active always come first,
// regardless of submission date. Everything else follows by date, with
// resolved tickets sinking to the bottom.
export function sortTicketsForDisplay(tickets: Ticket[]): Ticket[] {
  const urgentActive = tickets.filter((t) => t.type === 'Anunt accident' && t.status !== 'Terminat')
    .sort((a, b) => parseTicketDate(b.submitted_on).getTime() - parseTicketDate(a.submitted_on).getTime());
  const regularActive = tickets.filter((t) => t.type !== 'Anunt accident' && t.status !== 'Terminat')
    .sort((a, b) => parseTicketDate(b.submitted_on).getTime() - parseTicketDate(a.submitted_on).getTime());
  const done = tickets.filter((t) => t.status === 'Terminat')
    .sort((a, b) => parseTicketDate(b.resolved_on || b.submitted_on).getTime() - parseTicketDate(a.resolved_on || a.submitted_on).getTime());
  return [...urgentActive, ...regularActive, ...done];
}

// Ticket number order (numeric-aware), descending -- used by the
// overview table since date-sorting put archived tickets mixed back in
// a confusing order.
export function sortTicketsByNumber(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => (b.ticket_number || '').localeCompare(a.ticket_number || '', undefined, { numeric: true }));
}

export function ticketMatchesStatusFilter(t: Ticket, filterKey: StatusFilterKey): boolean {
  if (filterKey === 'AwaitingReport') return isAwaitingReport(t);
  return filterKey === 'Toate' || t.status === filterKey;
}

export const OVERVIEW_CARD_FILTER_LABELS: Record<Exclude<OverviewCardFilterKey, null>, string> = {
  active: 'Filtru activ: doar sesizări active',
  aging: 'Filtru activ: doar sesizări deschise de peste ' + AGING_THRESHOLD_DAYS + ' zile',
  functional: 'Filtru activ: doar sesizări cu defect',
  accident: 'Filtru activ: doar accidente',
  solved: 'Filtru activ: doar sesizări soluționate',
  awaiting_report: 'Filtru activ: doar sesizări ce așteaptă raport',
};

export const MONTH_FILTER_NAMES = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'];
export const MINI_CAL_MONTH_NAMES = MONTH_FILTER_NAMES;

// Shared by FilterPopover and each tab's separate desktop toolbar note
// span (two DOM spots showing the same text, mirroring the vanilla
// version's own duplicated-innerHTML approach) -- one definition so
// they can't drift out of sync with each other.
export function describeActiveDateFilter(opts: {
  year: string; yearTouched: boolean; month: string; monthTouched: boolean; day: number | null;
}): string {
  const now = new Date();
  const yearOk = !opts.yearTouched || String(opts.year) === String(now.getFullYear());
  const monthOk = !opts.monthTouched || String(opts.month) === String(now.getMonth() + 1);
  if (opts.day !== null && opts.day !== undefined) {
    const monthName = MONTH_FILTER_NAMES[Number(opts.month) - 1] || '';
    return `${opts.day} ${monthName} ${opts.year}`.trim();
  }
  const parts: string[] = [];
  if (!monthOk) parts.push(opts.month === 'all' ? 'toate lunile' : (MONTH_FILTER_NAMES[Number(opts.month) - 1] || ''));
  if (!yearOk) parts.push(opts.year === 'all' ? 'toți anii' : `an ${opts.year}`);
  return parts.filter(Boolean).join(', ');
}
