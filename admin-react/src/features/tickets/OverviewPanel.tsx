import { useTickets } from './TicketsContext';
import { useShareTickets } from './useShareTickets';
import { PriorityCards } from './PriorityCards';
import { OverviewCardsMobile, OverviewTable } from './OverviewTable';
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

export function OverviewPanel({ sessionEmail }: { sessionEmail: string | null }) {
  const store = useTickets();
  return (
    <>
      <PriorityCards />
      {store.addFormOpen && store.activeView === 'overview' && <TicketAddForm />}
      <div className="overview-section">
        <OverviewTable sessionEmail={sessionEmail} />
        <OverviewCardsMobile />
        <OverviewShareBar />
      </div>
    </>
  );
}
