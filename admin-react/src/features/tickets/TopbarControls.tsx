import { Fragment } from 'react';
import { useTickets } from './TicketsContext';
import { FilterPopover, type ChipDef } from './FilterPopover';
import { SearchToggle } from './SearchToggle';
import type { OverviewStatusFilterKey, StatusFilterKey } from './types';

// NOTE: these components render ONLY the inner content of each topbar
// slot -- the outer wrapper div (.overview-year-bar[data-year-panel=…],
// .overview-quick-filters[data-year-panel=…]) stays owned by admin-3.html
// / lps.js's openAdminTab (which toggles its own 'active' class by id/
// dataset match on the real DOM node). Mounting a SECOND nested
// .overview-year-bar/.overview-quick-filters inside it would break the
// CSS layout, which expects exactly one such element per topbar slot.

const SESIZARI_CHIP_DEFS: ChipDef<StatusFilterKey>[] = [
  { key: 'Ongoing', label: 'Active' },
  { key: 'Terminat', label: 'Soluționate' },
  { key: 'AwaitingReport', label: 'Așteaptă raport' },
  { key: 'Toate', label: 'Toate' },
];
const OVERVIEW_CHIP_DEFS: ChipDef<OverviewStatusFilterKey>[] = [
  { key: 'all', label: 'Toate' },
  { key: 'active', label: 'Active' },
  { key: 'awaiting_report', label: 'Așteaptă raport' },
  { key: 'done', label: 'Soluționate' },
];

export function YearMonthBarInner() {
  const store = useTickets();
  const now = new Date();
  const isPastYear = store.ticketYearFilter !== 'all' && store.ticketYearFilter !== String(now.getFullYear());
  return (
    <Fragment>
      <label>An:</label>
      <select className={isPastYear ? 'not-current-year' : ''} value={store.ticketYearFilter} onChange={(e) => store.setTicketYearFilter(e.target.value)}>
        <option value="all">Toate anii</option>
        {store.availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <label>Lună:</label>
      <select className={isPastYear ? 'not-current-year' : ''} value={store.ticketMonthFilter} onChange={(e) => store.setTicketMonthFilter(e.target.value)}>
        <option value="all">Toate lunile</option>
        {['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'].map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>
      {isPastYear && <span className="year-warning show">⚠ Nu e anul curent</span>}
    </Fragment>
  );
}

export function OverviewQuickFiltersInner({ sessionEmail }: { sessionEmail: string | null }) {
  const store = useTickets();
  return (
    <Fragment>
      <FilterPopover
        scope="overview" sessionEmail={sessionEmail}
        year={store.ticketYearFilter} setYear={store.setTicketYearFilter} yearTouched={store.ticketYearFilterTouched}
        month={store.ticketMonthFilter} setMonth={store.setTicketMonthFilter} monthTouched={store.ticketMonthFilterTouched}
        availableYears={store.availableYears}
        status={store.overviewStatusFilter} setStatus={store.setOverviewStatusFilter} chipDefs={OVERVIEW_CHIP_DEFS} defaultStatus="active" widenStatus="all"
        day={store.overviewDayFilter} setDay={store.setOverviewDayFilter}
        noteClassName="filter-status-note filter-status-note-overview"
      />
      <button type="button" className="overview-icon-btn add-btn" data-requires-write="tickets" title="Adaugă sesizare" aria-label="Adaugă sesizare" onClick={() => store.setAddFormOpen(true)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <SearchToggle
        query={store.overviewSearchQuery} setQuery={store.setOverviewSearchQuery} placeholder="Caută nume, adresă, telefon…"
        status={store.overviewStatusFilter} setStatus={store.setOverviewStatusFilter} widenStatus="all"
        year={store.ticketYearFilter} setYear={store.setTicketYearFilter}
        month={store.ticketMonthFilter} setMonth={store.setTicketMonthFilter}
        day={store.overviewDayFilter} setDay={store.setOverviewDayFilter}
      />
      {/* Both icons below are only triggers -- the click wiring, file
          parsing/preview and the Excel generation itself all still live
          in excel.js (shared with the "tickets" slot's import icon via
          the same #repairSheetInput file input), same as the vanilla
          version. */}
      <button type="button" className="overview-icon-btn repair-import-btn excel-icon-btn" id="importRepairSheetBtnOverview" title="Încarcă fișă remedieri" aria-label="Încarcă fișă remedieri">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
      </button>
      <button type="button" className="overview-icon-btn excel-icon-btn" id="exportExcelBtn" title="Raport Excel" aria-label="Raport Excel">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
      </button>
    </Fragment>
  );
}

export function TicketsQuickFiltersInner({ sessionEmail }: { sessionEmail: string | null }) {
  const store = useTickets();
  return (
    <Fragment>
      <FilterPopover
        scope="tickets" sessionEmail={sessionEmail}
        year={store.ticketYearFilter} setYear={store.setTicketYearFilter} yearTouched={store.ticketYearFilterTouched}
        month={store.ticketMonthFilter} setMonth={store.setTicketMonthFilter} monthTouched={store.ticketMonthFilterTouched}
        availableYears={store.availableYears}
        status={store.activeFilter} setStatus={store.setTicketFilter} chipDefs={SESIZARI_CHIP_DEFS} defaultStatus="Ongoing" widenStatus="Toate"
        day={store.overviewDayFilter} setDay={store.setOverviewDayFilter}
        noteClassName="filter-status-note"
      />
      <button type="button" className="overview-icon-btn add-btn" data-requires-write="tickets" title="Adaugă sesizare" aria-label="Adaugă sesizare" onClick={() => store.setAddFormOpen(true)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
      <SearchToggle
        query={store.ticketSearchQuery} setQuery={store.setTicketSearchQuery} placeholder="Caută adresă, nume, telefon, nr. sesizare…"
        status={store.activeFilter} setStatus={store.setTicketFilter} widenStatus="Toate"
        year={store.ticketYearFilter} setYear={store.setTicketYearFilter}
        month={store.ticketMonthFilter} setMonth={store.setTicketMonthFilter}
        day={store.overviewDayFilter} setDay={store.setOverviewDayFilter}
      />
      <span className="overview-quick-filters-count">{store.getFilteredTicketsForSesizari().length} tichete</span>
      {/* Same #repairSheetInput + excel.js wiring as the Overview slot's
          own import icon (see its comment) -- just a second trigger
          into the identical import flow. */}
      <button type="button" className="overview-icon-btn repair-import-btn excel-icon-btn" id="importRepairSheetBtn" title="Încarcă fișă remedieri" aria-label="Încarcă fișă remedieri">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
      </button>
    </Fragment>
  );
}
