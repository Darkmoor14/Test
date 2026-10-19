import { useTickets } from './TicketsContext';
import { TicketCard } from './TicketCard';
import { TicketArchiveBar, ActiveNarrowFilterBanner } from './TicketArchiveBar';
import { TicketAddForm } from './TicketAddForm';
import { sortTicketsForDisplay } from './ticketUtils';
import { describeActiveDateFilter, MONTH_FILTER_NAMES } from './ticketUtils';

export function TicketsPanel({ sessionEmail }: { sessionEmail: string | null }) {
  const store = useTickets();
  const filtered = sortTicketsForDisplay(store.getFilteredTicketsForSesizari());
  const dateNote = describeActiveDateFilter({
    year: store.ticketYearFilter, yearTouched: store.ticketYearFilterTouched,
    month: store.ticketMonthFilter, monthTouched: store.ticketMonthFilterTouched,
    day: store.overviewDayFilter,
  });
  void MONTH_FILTER_NAMES;

  return (
    <div className="admin-panel active">
      <div className="toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="result-count">{filtered.length} din {store.tickets.length} tichete</div>
          {dateNote && <span className="filter-status-note">Filtru: {dateNote}</span>}
        </div>
      </div>
      {store.addFormOpen && store.activeView !== 'overview' && <TicketAddForm />}
      <ActiveNarrowFilterBanner />
      <TicketArchiveBar />
      <div className="ticket-list">
        {filtered.length === 0 ? (
          <div className="no-results">Niciun tichet în această categorie.</div>
        ) : (
          filtered.map((t) => <TicketCard key={t.id} t={t} sessionEmail={sessionEmail} />)
        )}
      </div>
    </div>
  );
}
