import { createPortal } from 'react-dom';
import { TicketsStoreProvider } from './TicketsContext';
import { YearMonthBarInner, OverviewQuickFiltersInner, TicketsQuickFiltersInner } from './TopbarControls';
import { OverviewPanel } from './OverviewPanel';
import { TicketsPanel } from './TicketsPanel';
import { ReportsPanel } from './ReportsPanel';
import { DuplicateLinkSheet } from './DuplicateLinkSheet';

export interface TicketsMountTargets {
  overviewYearBar: HTMLElement;
  overviewQuickFilters: HTMLElement;
  ticketsYearBar: HTMLElement;
  ticketsQuickFilters: HTMLElement;
  ticketsPanelRoot: HTMLElement;
  reportsPanelRoot: HTMLElement;
}

// Mounted (via createRoot) directly at the Overview panel's own mount
// div -- everything else (the two topbar slots per tab, and the
// Sesizări/Rapoarte panels themselves) is a portal INTO its real DOM
// container, so one React tree/context covers all 6 spots that share
// the same tickets data + filter state. See admin-3.html's bootstrap
// script and mount.tsx for how each target element is found.
export function TicketsRoot({ sessionEmail, targets }: { sessionEmail: string | null; targets: TicketsMountTargets }) {
  return (
    <TicketsStoreProvider sessionEmail={sessionEmail}>
      {/* No overviewYearBar portal here on purpose -- the calendar icon
          in OverviewQuickFiltersInner is now the only date-filter
          control for this tab, so the old topbar An/Lună dropdowns
          (still used by the Sesizări tabs below, via ticketsYearBar)
          would just be a second, redundant copy of the same picker. */}
      {createPortal(<OverviewQuickFiltersInner sessionEmail={sessionEmail} />, targets.overviewQuickFilters)}
      {createPortal(<YearMonthBarInner />, targets.ticketsYearBar)}
      {createPortal(<TicketsQuickFiltersInner sessionEmail={sessionEmail} />, targets.ticketsQuickFilters)}
      {createPortal(<TicketsPanel sessionEmail={sessionEmail} />, targets.ticketsPanelRoot)}
      {createPortal(<ReportsPanel />, targets.reportsPanelRoot)}
      <OverviewPanel sessionEmail={sessionEmail} />
      <DuplicateLinkSheet />
    </TicketsStoreProvider>
  );
}
