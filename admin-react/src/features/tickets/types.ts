export interface Ticket {
  id: string;
  ticket_number: string | null;
  type: string; // 'Sesizare functionala' | 'Anunt accident'
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  description: string | null;
  status: string; // 'Ongoing' | 'Terminat'
  resolved_by: string | null;
  resolution_note: string | null;
  submitted_on: string | null;
  resolved_on: string | null;
  archived: boolean | null;
  archived_at: string | null;
  duplicate_of: string | null;
  pre_duplicate_status: string | null;
}

export type StatusFilterKey = 'Ongoing' | 'Terminat' | 'AwaitingReport' | 'Toate';
export type OverviewStatusFilterKey = 'all' | 'active' | 'done' | 'awaiting_report';
export type OverviewCardFilterKey = 'active' | 'aging' | 'functional' | 'accident' | 'solved' | 'awaiting_report' | null;
export type TypeOnlyFilterKey = 'functional' | 'accident' | null;
export type ActiveTypeFilterKey = 'Toate' | 'functional' | 'accident';

// status isn't stored here -- it's derived from priority/year/month
// (see overviewStatusFilter in useTicketsStore.ts), so restoring those
// three on return already puts it back where it was automatically.
export interface OverviewReturnState {
  priority: OverviewCardFilterKey;
  year: string;
  month: string;
  ticketId: string;
}
