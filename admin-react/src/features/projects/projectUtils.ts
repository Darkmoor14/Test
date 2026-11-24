import type { Project, ProjectStatusKey } from './types';

export function calcProjectProgress(startISO: string, dueISO: string): number {
  const now = new Date();
  const start = new Date(startISO);
  const due = new Date(dueISO);
  if (now <= start) return 0;
  if (now >= due) return 100;
  return Math.round(((now.getTime() - start.getTime()) / (due.getTime() - start.getTime())) * 100);
}

export function calcProjectStatus(startISO: string, dueISO: string): { key: ProjectStatusKey; label: string } {
  const now = new Date();
  const start = new Date(startISO);
  const due = new Date(dueISO);
  if (now < start) return { key: 'scheduled', label: 'Programat' };
  if (now >= due) return { key: 'done', label: 'Finalizat' };
  return { key: 'progress', label: 'În desfășurare' };
}

export function getProjectStatusFilterKey(p: Project): 'Ongoing' | 'Terminat' {
  return calcProjectStatus(p.start_date, p.due_date).key === 'done' ? 'Terminat' : 'Ongoing';
}

export function matchesProjectYear(p: Project, yearFilter: string): boolean {
  if (yearFilter === 'all') return true;
  if (!p.start_date) return false;
  return String(new Date(p.start_date).getFullYear()) === String(yearFilter);
}

export function matchesProjectSearch(p: Project, query: string): boolean {
  if (!query) return true;
  const haystack = [p.title, p.address].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

export function daysSince(dateStr: string | null, endDateStr: string | null): number {
  if (!dateStr) return 0;
  const start = new Date(dateStr);
  const end = endDateStr ? new Date(endDateStr) : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Project start_date/due_date are month-precision only (the form picks
// a month, not a day) -- this is for displaying those two fields
// specifically, as opposed to fmtDateShort, which still shows the real
// day for dates that do carry one (e.g. archived_at).
export function fmtMonthYear(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
}

// <input type="month"> works with "YYYY-MM" values, but start_date/
// due_date are stored as full SQL dates. toMonthInput truncates a
// stored date down for the input's value; monthInputToDate expands a
// picked month back out to a full date to store -- the 1st for a
// start date, the last calendar day for a due date (so a project due
// "decembrie 2026" still counts as in-progress through the whole
// month instead of flipping to done on the 1st).
export function toMonthInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 7) : '';
}

export function monthInputToDate(monthValue: string, endOfMonth: boolean): string {
  const [yearStr, monthStr] = monthValue.split('-');
  const year = Number(yearStr), month = Number(monthStr);
  if (!endOfMonth) return `${yearStr}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  return `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
}

export function formatWoDateRO(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

export const HOME_CLOCK_MONTH_NAMES = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
