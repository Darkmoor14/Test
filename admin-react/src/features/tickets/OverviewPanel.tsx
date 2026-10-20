import { useTickets } from './TicketsContext';
import { useShareTickets } from './useShareTickets';
import { PriorityCards } from './PriorityCards';
import { OverviewCardsMobile, OverviewNarrowFilterBanner, OverviewTable } from './OverviewTable';
import { TicketAddForm } from './TicketAddForm';

function OverviewShareBar() {
  const store = useTickets();
  const { shareSelected } = useShareTickets();
  if (store.overviewShareSelectedIds.size === 0) return null;
  return (
    <div className="archive-bar show">
      <span>{store.overviewShareSelectedIds.size} selectate</span>
      <button className="btn" type="button" onClick={store.clearShareSelection}>Anulează selecția</button>
      <button className="btn btn-primary" type="button" onClick={shareSelected}>Trimite selectate</button>
    </div>
  );
}

function InlineYearMonthBar() {
  const store = useTickets();
  const now = new Date();
  const isPastYear = store.ticketYearFilter !== 'all' && store.ticketYearFilter !== String(now.getFullYear());
  return (
    <div className="overview-year-bar">
      <label>An:</label>
      <select value={store.ticketYearFilter} onChange={(e) => store.setTicketYearFilter(e.target.value)}>
        <option value="all">Toate anii</option>
        {store.availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <label>Lună:</label>
      <select value={store.ticketMonthFilter} onChange={(e) => store.setTicketMonthFilter(e.target.value)}>
        <option value="all">Toate lunile</option>
        {['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'].map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>
      {isPastYear && <span className="year-warning show">⚠ Nu e anul curent</span>}
    </div>
  );
}

export function OverviewPanel({ sessionEmail }: { sessionEmail: string | null }) {
  const store = useTickets();
  return (
    <>
      <PriorityCards />
      {store.addFormOpen && store.activeView === 'overview' && <TicketAddForm />}
      <InlineYearMonthBar />
      <div className="overview-section">
        <OverviewNarrowFilterBanner />
        <OverviewTable sessionEmail={sessionEmail} />
        <OverviewCardsMobile />
        <OverviewShareBar />
      </div>
    </>
  );
}
