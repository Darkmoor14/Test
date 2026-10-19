import { useEffect, useRef, useState } from 'react';
import { MONTH_FILTER_NAMES } from './ticketUtils';
import { MiniDayCalendar } from './MiniDayCalendar';
import { useSavedFilterViews, type SavedFilterView } from './useSavedFilterViews';

export interface ChipDef<K extends string> { key: K; label: string; }

export function FilterPopover<K extends string>({
  scope, sessionEmail,
  year, setYear, yearTouched, month, setMonth, monthTouched, availableYears, showDateFilters = true,
  status, setStatus, chipDefs, defaultStatus,
  day, setDay, noteClassName,
}: {
  scope: string; sessionEmail: string | null;
  year: string; setYear: (v: string) => void; yearTouched: boolean;
  month: string; setMonth: (v: string) => void; monthTouched: boolean;
  availableYears: number[]; showDateFilters?: boolean;
  status: K; setStatus: (v: K) => void; chipDefs: ChipDef<K>[]; defaultStatus: K;
  day: number | null; setDay: (v: number | null) => void;
  noteClassName?: string;
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
  const statusOk = status === defaultStatus;
  const isDefault = statusOk && yearOk && monthOk && dayOk;

  const describeFilter = (): string => {
    const parts: string[] = [];
    if (status !== defaultStatus) {
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
    setStatus(defaultStatus);
    if (showDateFilters) {
      setYear(String(now.getFullYear()));
      setMonth(String(now.getMonth() + 1));
    }
    setDay(null);
  };

  const applyView = (v: SavedFilterView) => {
    setStatus(v.filter_json.status as K);
    if (showDateFilters && v.filter_json.year !== undefined && v.filter_json.year !== null) setYear(String(v.filter_json.year));
    if (showDateFilters && v.filter_json.month !== undefined && v.filter_json.month !== null) setMonth(String(v.filter_json.month));
    setDay(v.filter_json.day !== undefined ? (v.filter_json.day ?? null) : null);
  };

  const noteText = isDefault ? '' : describeFilter();

  return (
    <>
      <div className="overview-popover-wrap" ref={wrapRef}>
        <button type="button" className={`overview-icon-btn${!isDefault ? ' active' : ''}`} aria-label="Filtre" onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
        </button>
        <div className={`filter-popover${open ? ' open' : ''}`}>
          {showDateFilters && (
            <div className="sheet-grid popover-yearmonth">
              <div className="ctrl-field">
                <label>An</label>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="all">Toate anii</option>
                  {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="ctrl-field">
                <label>Lună</label>
                <select value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="all">Toate lunile</option>
                  {MONTH_FILTER_NAMES.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
                </select>
              </div>
            </div>
          )}
          {showDateFilters && (
            <MiniDayCalendar year={year} month={month} day={day} setYear={setYear} setMonth={setMonth} setDay={setDay} onPicked={() => {}} />
          )}
          <div className="sheet-filter-status">
            <label>Stare listă</label>
            <div className="chips">
              {chipDefs.map((c) => (
                <button key={c.key} type="button" className={`chip${c.key === status ? ' active' : ''}`} onClick={() => setStatus(c.key)}>{c.label}</button>
              ))}
            </div>
          </div>
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
                save(name, { status, year: showDateFilters ? year : undefined, month: showDateFilters ? month : undefined, day });
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
