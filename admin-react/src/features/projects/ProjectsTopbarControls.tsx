import { Fragment, useEffect, useRef, useState } from 'react';
import { useProjects } from './ProjectsContext';
import { SearchToggle } from '../tickets/SearchToggle';
import { useSavedFilterViews, type SavedFilterView } from '../tickets/useSavedFilterViews';
import type { BacklogFilterKey, ProjectsFilterKey } from './types';

interface ChipDef<K extends string> { key: K; label: string; }
const STATUS_CHIP_DEFS: ChipDef<ProjectsFilterKey | BacklogFilterKey>[] = [
  { key: 'Ongoing', label: 'Active' },
  { key: 'Terminat', label: 'Soluționate' },
  { key: 'Toate', label: 'Toate' },
];

// Lighter-weight sibling of tickets/FilterPopover.tsx -- Proiecte only
// ever had a year select (no month/day granularity) and Avarii had no
// date filter at all, so rather than stretch the ticket popover's
// year+month+MiniDayCalendar shape to fit, this renders just what each
// one actually had in the vanilla version.
function SimpleFilterPopover<K extends string>({
  scope, sessionEmail, year, setYear, availableYears,
  status, setStatus, defaultStatus, noteClassName,
}: {
  scope: string; sessionEmail: string | null;
  year?: string; setYear?: (v: string) => void; availableYears?: number[];
  status: K; setStatus: (v: K) => void; defaultStatus: K;
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

  const yearOk = !year || year === 'all';
  const statusOk = status === defaultStatus;
  const isDefault = statusOk && yearOk;

  const describeFilter = (): string => {
    const parts: string[] = [];
    if (status !== defaultStatus) {
      const chip = STATUS_CHIP_DEFS.find((c) => c.key === status);
      if (chip) parts.push(chip.label);
    }
    if (!yearOk) parts.push(`an ${year}`);
    return parts.filter(Boolean).join(', ');
  };

  const resetFilter = () => {
    setStatus(defaultStatus);
    if (setYear) setYear('all');
  };

  const applyView = (v: SavedFilterView) => {
    setStatus(v.filter_json.status as K);
    if (setYear && v.filter_json.year !== undefined && v.filter_json.year !== null) setYear(String(v.filter_json.year));
  };

  const noteText = isDefault ? '' : describeFilter();

  return (
    <>
      <div className="overview-popover-wrap" ref={wrapRef}>
        <button type="button" className={`overview-icon-btn${!isDefault ? ' active' : ''}`} aria-label="Filtre" onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
        </button>
        <div className={`filter-popover${open ? ' open' : ''}`}>
          {setYear && (
            <div className="sheet-grid popover-yearmonth">
              <div className="ctrl-field">
                <label>An</label>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="all">Toate anii</option>
                  {(availableYears || []).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          )}
          <div className="sheet-filter-status">
            <label>Stare listă</label>
            <div className="chips">
              {STATUS_CHIP_DEFS.map((c) => (
                <button key={c.key} type="button" className={`chip${c.key === status ? ' active' : ''}`} onClick={() => setStatus(c.key as K)}>{c.label}</button>
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
                save(name, { status, year: setYear ? year : undefined });
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

export function ProjectsYearBarInner() {
  const store = useProjects();
  const now = new Date();
  const isPastYear = store.projectYearFilter !== 'all' && store.projectYearFilter !== String(now.getFullYear());
  return (
    <Fragment>
      <label>An:</label>
      <select className={isPastYear ? 'not-current-year' : ''} value={store.projectYearFilter} onChange={(e) => store.setProjectYearFilter(e.target.value)}>
        <option value="all">Toate anii</option>
        {store.projectAvailableYears.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {isPastYear && <span className="year-warning show">⚠ Nu e anul curent</span>}
    </Fragment>
  );
}

export function ProjectsQuickFiltersInner({ sessionEmail }: { sessionEmail: string | null }) {
  const store = useProjects();
  return (
    <Fragment>
      <SimpleFilterPopover
        scope="projects" sessionEmail={sessionEmail}
        year={store.projectYearFilter} setYear={store.setProjectYearFilter} availableYears={store.projectAvailableYears}
        status={store.projectsFilter} setStatus={store.setProjectsFilter} defaultStatus="Ongoing"
        noteClassName="filter-status-note"
      />
      <button type="button" className="overview-icon-btn add-btn" data-requires-write="proiecte" title="Adaugă proiect" aria-label="Adaugă proiect" onClick={() => store.openProjectForm(null)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <SearchToggle
        query={store.projectSearchQuery} setQuery={store.setProjectSearchQuery} placeholder="Caută titlu, adresă…"
        status={store.projectsFilter} setStatus={store.setProjectsFilter} widenStatus="Toate"
        year={store.projectYearFilter} setYear={store.setProjectYearFilter}
      />
      <span className="overview-quick-filters-count">{store.filteredProjects.length} proiecte</span>
      {/* Excel import returns in its own follow-up round (see migration tracker). */}
    </Fragment>
  );
}

export function BacklogQuickFiltersInner({ sessionEmail }: { sessionEmail: string | null }) {
  const store = useProjects();
  return (
    <Fragment>
      <SimpleFilterPopover
        scope="backlog" sessionEmail={sessionEmail}
        status={store.backlogFilter} setStatus={store.setBacklogFilter} defaultStatus="Ongoing"
        noteClassName="filter-status-note"
      />
      <button type="button" className="overview-icon-btn add-btn" data-requires-write="proiecte" title="Adaugă lucrare" aria-label="Adaugă lucrare" onClick={() => store.openBacklogForm(null)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <SearchToggle
        query={store.backlogSearchQuery} setQuery={store.setBacklogSearchQuery} placeholder="Caută titlu, adresă, angajat…"
        status={store.backlogFilter} setStatus={store.setBacklogFilter} widenStatus="Toate"
      />
      <span className="overview-quick-filters-count">{store.filteredBacklogProjects.length} lucrări</span>
      {/* Excel export returns in its own follow-up round (see migration tracker). */}
    </Fragment>
  );
}
