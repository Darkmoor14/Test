import { useEffect, useRef, useState } from 'react';
import { MONTH_FILTER_NAMES } from './ticketUtils';
import { MiniDayCalendar } from './MiniDayCalendar';
import { useSavedFilterViews, type SavedFilterView } from './useSavedFilterViews';

export interface ChipDef<K extends string> { key: K; label: string; }

export function FilterPopover<K extends string>({
  scope, sessionEmail,
  year, setYear, yearTouched, month, setMonth, monthTouched, availableYears, showDateFilters = true,
  status, setStatus, chipDefs, defaultStatus, widenStatus,
  day, setDay, noteClassName, icon = 'funnel',
}: {
  scope: string; sessionEmail: string | null;
  year: string; setYear: (v: string) => void; yearTouched: boolean;
  month: string; setMonth: (v: string) => void; monthTouched: boolean;
  availableYears: number[]; showDateFilters?: boolean;
  // status/setStatus/defaultStatus/chipDefs/widenStatus all omitted
  // together for Overview -- where the priority cards own status, and
  // overviewStatusFilter is derived rather than stored, so there's
  // nothing left for this popover to read, write or widen. It then
  // only covers date (year/month/day): no chip row, and status never
  // counts toward "is this popover showing a non-default filter", so
  // it can't produce a second, redundant note next to the cards' own.
  status?: K; setStatus?: (v: K) => void; chipDefs?: ChipDef<K>[]; defaultStatus?: K; widenStatus?: K;
  day: number | null; setDay: (v: number | null) => void;
  noteClassName?: string; icon?: 'funnel' | 'calendar';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { views, load, save, remove } = useSavedFilterViews(scope, sessionEmail);

  useEffect(() => {
    if (!open) return;
    load();
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open, load]);

  const now = new Date();
  const yearOk = !showDateFilters || !yearTouched || String(year) === String(now.getFullYear());
  const monthOk = !showDateFilters || !monthTouched || String(month) === String(now.getMonth() + 1);
  const dayOk = day === null || day === undefined;
  const statusOk = !chipDefs || status === defaultStatus;
  const isDefault = statusOk && yearOk && monthOk && dayOk;

  const describeFilter = (): string => {
    const parts: string[] = [];
    if (chipDefs && status !== defaultStatus) {
      const chip = chipDefs.find((c) => c.key === status);
      if (chip) parts.push(chip.label);
    }
    if (day !== null && day !== undefined) {
      const monthName = MONTH_FILTER_NAMES[Number(month) - 1] || '';
      parts.push(`${day} ${monthName} ${year}`.trim());
    } else if (showDateFilters) {
      if (!monthOk) parts.push(month === 'all' ? 'toate lunile' : (MONTH_FILTER_NAMES[Number(month) - 1] || ''));
      if (!yearOk) parts.push(year === 'all' ? 'toți anii' : `an ${year}`);
    }
    return parts.filter(Boolean).join(', ');
  };

  const resetFilter = () => {
    if (setStatus && defaultStatus !== undefined) setStatus(defaultStatus);
    if (showDateFilters) {
      setYear(String(now.getFullYear()));
      setMonth(String(now.getMonth() + 1));
    }
    setDay(null);
  };

  const applyView = (v: SavedFilterView) => {
    if (setStatus) setStatus(v.filter_json.status as K);
    if (showDateFilters && v.filter_json.year !== undefined && v.filter_json.year !== null) setYear(String(v.filter_json.year));
    if (showDateFilters && v.filter_json.month !== undefined && v.filter_json.month !== null) setMonth(String(v.filter_json.month));
    setDay(v.filter_json.day !== undefined ? (v.filter_json.day ?? null) : null);
  };

  const noteText = isDefault ? '' : describeFilter();

  // Picking an actual year/month is as narrowing an action as picking a
  // specific day (see setDay's own widening below) or starting a search
  // (SearchToggle) -- without also widening status, choosing e.g.
  // "Septembrie" while still on the default "Active" chip silently
  // combined into "status=active AND month=September", which hid every
  // September ticket that had since been resolved and just showed an
  // empty list with nothing on screen explaining why. Resetting back to
  // "Toate anii"/"Toate lunile" doesn't widen -- only an actual pick does.
  const narrowingSetYear = (v: string) => {
    if (v !== 'all' && widenStatus !== undefined && setStatus) setStatus(widenStatus);
    setYear(v);
  };
  const narrowingSetMonth = (v: string) => {
    if (v !== 'all' && widenStatus !== undefined && setStatus) setStatus(widenStatus);
    setMonth(v);
  };

  return (
    <>
      <div className="overview-popover-wrap" ref={wrapRef}>
        <button type="button" className={`overview-icon-btn${!isDefault ? ' active' : ''}`} aria-label={icon === 'calendar' ? 'Filtrează după dată' : 'Filtre'} onClick={() => setOpen((o) => !o)}>
          {icon === 'calendar' ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
          )}
        </button>
        <div className={`filter-popover${open ? ' open' : ''}`}>
          {showDateFilters && (
            <div className="sheet-grid popover-yearmonth">
              <div className="ctrl-field">
                <label>An</label>
                <select value={year} onChange={(e) => narrowingSetYear(e.target.value)}>
                  <option value="all">Toate anii</option>
                  {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="ctrl-field">
                <label>Lună</label>
                <select value={month} onChange={(e) => narrowingSetMonth(e.target.value)}>
                  <option value="all">Toate lunile</option>
                  {MONTH_FILTER_NAMES.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
                </select>
              </div>
            </div>
          )}
          {showDateFilters && (
            <MiniDayCalendar
              year={year} month={month} day={day} setYear={narrowingSetYear} setMonth={narrowingSetMonth}
              setDay={(d) => {
                // Picking an actual day is as strong a narrowing action as
                // starting a search (see SearchToggle's own widenStatus) --
                // without also widening the status chip, a day pick made
                // while still on the default "Active"/"Ongoing" chip
                // silently combined with it (day X AND still-active),
                // which excluded any ticket from that day already marked
                // Terminat and just showed "Nicio sesizare" with nothing
                // on screen explaining why. Clearing the day (d === null,
                // via "Toate zilele" or the month label) doesn't widen --
                // only an actual pick does.
                if (d !== null && widenStatus !== undefined && setStatus) setStatus(widenStatus);
                setDay(d);
              }}
              onPicked={() => {}}
            />
          )}
          {chipDefs && (
            <div className="sheet-filter-status">
              <label>Stare listă</label>
              <div className="chips">
                {chipDefs.map((c) => (
                  <button key={c.key} type="button" className={`chip${c.key === status ? ' active' : ''}`} onClick={() => setStatus?.(c.key)}>{c.label}</button>
                ))}
              </div>
            </div>
          )}
          <div className="popover-saved-views">
            <label>Vizualizări salvate</label>
            <div className="saved-views-chips">
              {views.map((v) => (
                <span key={v.id} className="saved-view-chip" onClick={() => applyView(v)}>
                  <span>{v.name}</span>
                  <span className="saved-view-chip-remove" aria-label="Șterge vizualizarea" onClick={(e) => { e.stopPropagation(); remove(v.id); }}>×</span>
                </span>
              ))}
            </div>
            <button
              type="button"
              className="save-view-btn"
              onClick={() => {
                const name = (prompt('Nume pentru această vizualizare:') || '').trim();
                if (!name) return;
                save(name, { status: status ?? 'all', year: showDateFilters ? year : undefined, month: showDateFilters ? month : undefined, day });
              }}
            >
              + Salvează vizualizarea curentă
            </button>
          </div>
        </div>
      </div>
      {noteText && (
        <span className={noteClassName || 'filter-status-note'}>
          Filtru: {noteText} <button type="button" aria-label="Revino la vizualizarea implicită" onClick={resetFilter}>×</button>
        </span>
      )}
    </>
  );
}
