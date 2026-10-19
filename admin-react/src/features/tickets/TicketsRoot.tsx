import { createPortal } from 'react-dom';
import { TicketsStoreProvider } from './TicketsContext';
import { YearMonthBarInner, OverviewQuickFiltersInner, TicketsQuickFiltersInner } from './TopbarControls';
import { OverviewPanel } from './OverviewPanel';
import { TicketsPanel } from './TicketsPanel';
import { DuplicateLinkSheet } from './DuplicateLinkSheet';

export interface TicketsMountTargets {
  overviewYearBar: HTMLElement;
  overviewQuickFilters: HTMLElement;
  ticketsYearBar: HTMLElement;
  ticketsQuickFilters: HTMLElement;
  ticketsPanelRoot: HTMLElement;
}

// Mounted (via createRoot) directly at the Overview panel's own mount
// div -- everything else (the two topbar slots per tab, and the
// Sesizări panel itself) is a portal INTO its real DOM container, so
// one React tree/context covers all 5 spots that share the same
// tickets data + filter state. See admin-3.html's bootstrap script and
// mount.tsx for how each target element is found.
export function TicketsRoot({ sessionEmail, targets }: { sessionEmail: string | null; targets: TicketsMountTargets }) {
  return (
    <TicketsStoreProvider sessionEmail={sessionEmail}>
      {createPortal(<YearMonthBarInner />, targets.overviewYearBar)}
      {createPortal(<OverviewQuickFiltersInner sessionEmail={sessionEmail} />, targets.overviewQuickFilters)}
      {createPortal(<YearMonthBarInner />, targets.ticketsYearBar)}
      {createPortal(<TicketsQuickFiltersInner sessionEmail={sessionEmail} />, targets.ticketsQuickFilters)}
      {createPortal(<TicketsPanel sessionEmail={sessionEmail} />, targets.ticketsPanelRoot)}
      <OverviewPanel sessionEmail={sessionEmail} />
      <DuplicateLinkSheet />
    </TicketsStoreProvider>
  );
}
