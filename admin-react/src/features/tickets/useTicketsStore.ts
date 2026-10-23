import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import type {
  ActiveTypeFilterKey, OverviewCardFilterKey, OverviewReturnState, OverviewStatusFilterKey,
  StatusFilterKey, Ticket, TypeOnlyFilterKey,
} from './types';
import {
  AGING_THRESHOLD_DAYS, getCanonicalTicket, getEffectiveMonthYear, isAwaitingReport, isDuplicateTicket,
  matchesMonth, matchesSearch, matchesYear, parseTicketDate, sortTicketsByNumber, ticketMatchesStatusFilter,
} from './ticketUtils';

declare global {
  interface Window {
    showToast?: (message: string) => void;
    goToTicketByNumber?: (ticketNumber: string) => boolean;
    allTickets?: Ticket[];
    goToTicket?: (ticketId: string) => void;
    openAdminTab?: (tabKey: string) => void;
    ticketYearFilter?: string;
    loadTickets?: () => Promise<void>;
    getEffectiveMonthYear?: (t: Ticket) => { year: number | null; month: number | null };
    isDuplicateTicket?: (t: Ticket | null | undefined) => boolean;
    sortTicketsByNumber?: (tickets: Ticket[]) => Ticket[];
    getCanonicalTicket?: (t: Ticket | null | undefined) => Ticket | null;
  }
}

function showToast(message: string) {
  if (typeof window.showToast === 'function') window.showToast(message);
}

// Mirrors admin-core.js's refreshAllAdminData/openAdminTab tab-switch
// behavior -- lps.js dispatches this (see the admin-core.js/lps.js
// changes made when mounting Tickets) so this still-independent React
// module knows when the person switches INTO a ticket-related tab
// (to silently refresh, same as every other tab already did) and which
// of the two Sesizări sub-tabs (Defecte/Accidente) is now showing.
const TAB_CHANGE_EVENT = 'admin:tabchange';

export type ActiveTicketView = 'overview' | 'tickets-functional' | 'tickets-accident' | 'other';

function viewFromTabKey(tabKey: string): ActiveTicketView {
  if (tabKey === 'overview') return 'overview';
  if (tabKey === 'tickets-functional') return 'tickets-functional';
  if (tabKey === 'tickets-accident') return 'tickets-accident';
  return 'other';
}

export function useTicketsStore(sessionEmail: string | null) {
  const supabase = useSupabase();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- filter state (mirrors tickets.js's module-scope variables) ----
  const [activeFilter, setActiveFilterState] = useState<StatusFilterKey>('Ongoing');
  const [activeTypeFilter, setActiveTypeFilter] = useState<ActiveTypeFilterKey>('Toate');
  const [agingOnlyFilter, setAgingOnlyFilter] = useState(false);
  const [typeOnlyFilter, setTypeOnlyFilter] = useState<TypeOnlyFilterKey>(null);
  const [ticketSearchQuery, setTicketSearchQuery] = useState('');
  const [ticketYearFilter, setTicketYearFilterState] = useState('all');
  const [ticketMonthFilter, setTicketMonthFilterState] = useState('all');
  const [ticketYearFilterTouched, setTicketYearFilterTouched] = useState(false);
  const [ticketMonthFilterTouched, setTicketMonthFilterTouched] = useState(false);
  const [ticketYearFilterInitialized, setTicketYearFilterInitialized] = useState(false);
  const [overviewDayFilter, setOverviewDayFilter] = useState<number | null>(null);

  const [overviewStatusFilter, setOverviewStatusFilter] = useState<OverviewStatusFilterKey>('active');
  const [overviewSearchQuery, setOverviewSearchQuery] = useState('');
  const [overviewCardFilter, setOverviewCardFilter] = useState<OverviewCardFilterKey>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [overviewShareSelectedIds, setOverviewShareSelectedIds] = useState<Set<string>>(new Set());
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const draftEditsRef = useRef<Record<string, Record<string, string>>>({});

  const [addFormOpen, setAddFormOpen] = useState(false);
  const [duplicateSheet, setDuplicateSheet] = useState<{ excludeTicketId: string | null } | null>(null);

  const [activeView, setActiveView] = useState<ActiveTicketView>('overview');
  const [overviewReturnState, setOverviewReturnState] = useState<OverviewReturnState | null>(null);
  const [jumpHighlightId, setJumpHighlightId] = useState<string | null>(null);
  const [pendingScrollToId, setPendingScrollToId] = useState<string | null>(null);

  const pendingTicketUrlParamHandled = useRef(false);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('tickets').select('*').order('submitted_on', { ascending: false });
    if (error) {
      console.error('loadTickets failed:', error);
      setLoading(false);
      return;
    }
    setTickets((data as Ticket[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { if (sessionEmail) reload(); }, [sessionEmail, reload]);

  // Years actually present (by effective year), newest first -- drives
  // the year filter's own option list. The current year is force-added
  // the first time so a brand-new install (no tickets yet) still shows
  // it as a pickable, selected option.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    tickets.forEach((t) => {
      const { year } = getEffectiveMonthYear(t);
      if (year) years.add(year);
    });
    return [...years].sort((a, b) => b - a);
  }, [tickets]);

  useEffect(() => {
    if (!ticketYearFilterInitialized && tickets.length >= 0) {
      const currentYear = new Date().getFullYear();
      setTicketYearFilterState(availableYears.includes(currentYear) ? String(currentYear) : 'all');
      setTicketYearFilterInitialized(true);
    } else if (ticketYearFilterInitialized && ticketYearFilter !== 'all' && !availableYears.some((y) => String(y) === ticketYearFilter)) {
      // only an explicit reload would yank this back in the vanilla version;
      // harmless to just leave it here since a stale selection simply shows "no results"
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableYears, ticketYearFilterInitialized]);

  const setTicketYearFilter = useCallback((value: string) => {
    setTicketYearFilterState(value);
    setTicketYearFilterTouched(true);
  }, []);
  const setTicketMonthFilter = useCallback((value: string) => {
    setTicketMonthFilterState(value);
    setTicketMonthFilterTouched(true);
  }, []);

  const setTicketFilter = useCallback((filterKey: StatusFilterKey) => {
    setActiveFilterState(filterKey);
    setSelectedIds(new Set());
  }, []);

  // ---- tab-change bridge (see TAB_CHANGE_EVENT comment above) ----
  useEffect(() => {
    const handler = (e: Event) => {
      const tabKey = (e as CustomEvent<string>).detail;
      const view = viewFromTabKey(tabKey);
      setActiveView((prev) => {
        if (view === 'tickets-functional') setActiveTypeFilter('functional');
        else if (view === 'tickets-accident') setActiveTypeFilter('accident');
        if (view !== 'other' && prev !== view) reload();
        return view === 'other' ? prev : view;
      });
    };
    window.addEventListener(TAB_CHANGE_EVENT, handler);
    return () => window.removeEventListener(TAB_CHANGE_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  // ---- derived filtered lists ----
  const getFilteredTicketsForSesizari = useCallback((): Ticket[] => {
    const query = ticketSearchQuery.trim().toLowerCase();
    let base: Ticket[];
    if (activeFilter === 'AwaitingReport') {
      base = tickets.filter((t) => isAwaitingReport(t));
    } else {
      base = tickets.filter((t) => (activeFilter === 'Toate' ? true : t.status === activeFilter));
    }
    if (activeTypeFilter === 'accident') base = base.filter((t) => t.type === 'Anunt accident');
    else if (activeTypeFilter === 'functional') base = base.filter((t) => t.type !== 'Anunt accident');

    base = base.filter((t) => matchesSearch(t, query) && matchesYear(t, ticketYearFilter) && matchesMonth(t, ticketMonthFilter));

    if (agingOnlyFilter) {
      base = base.filter((t) => {
        if (t.status === 'Terminat' || !t.submitted_on) return false;
        const daysOpen = (Date.now() - parseTicketDate(t.submitted_on).getTime()) / 86400000;
        return daysOpen > AGING_THRESHOLD_DAYS;
      });
    }
    if (typeOnlyFilter === 'functional') base = base.filter((t) => t.type !== 'Anunt accident');
    if (typeOnlyFilter === 'accident') base = base.filter((t) => t.type === 'Anunt accident');

    if (overviewDayFilter !== null) {
      base = base.filter((t) => {
        const d = parseTicketDate(t.submitted_on);
        return !isNaN(d.getTime()) && d.getDate() === overviewDayFilter;
      });
    }
    return base;
  }, [tickets, ticketSearchQuery, activeFilter, activeTypeFilter, ticketYearFilter, ticketMonthFilter, agingOnlyFilter, typeOnlyFilter, overviewDayFilter]);

  const clearNarrowFilter = useCallback(() => {
    setAgingOnlyFilter(false);
    setTypeOnlyFilter(null);
  }, []);

  // A priority card's own condition (status === 'Terminat' for
  // "Soluționate"/"Așteaptă raport", status !== 'Terminat' for the
  // other four) already fully determines which status(es) it shows --
  // so it also resets overviewStatusFilter to 'all', not just the card
  // itself. Leaving that at whatever it last was (its own default is
  // 'active') meant e.g. clicking "Soluționate" while it was still
  // 'active' combined into status !== 'Terminat' AND status ===
  // 'Terminat', an impossible intersection -- the card looked broken,
  // always showing zero rows, regardless of which one was clicked.
  const applyOverviewCardFilter = useCallback((filterKey: OverviewCardFilterKey) => {
    setOverviewCardFilter(filterKey);
    setOverviewStatusFilter('all');
  }, []);
  // Undoes applyOverviewCardFilter above. Naively resetting status
  // straight back to its hardcoded 'active' default broke browsing a
  // specific month: picking e.g. Septembrie already widens status to
  // 'all' (see narrowingSetYear/narrowingSetMonth in FilterPopover) so
  // the month shows everything, open or solved -- clicking a card and
  // then clearing it would blow that away and snap back to active-only,
  // which (combined with the card's own type filter already having
  // narrowed what's visible) looked like the card filter was still
  // stuck on even after removing it. Restore 'all' instead whenever a
  // specific month/year is still selected, 'active' only when it's not.
  const clearOverviewCardFilter = useCallback(() => {
    setOverviewCardFilter(null);
    setOverviewStatusFilter(ticketYearFilter !== 'all' || ticketMonthFilter !== 'all' ? 'all' : 'active');
  }, [ticketYearFilter, ticketMonthFilter]);

  // ---- selection / editing ----
  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const toggleShareSelected = useCallback((id: string) => {
    setOverviewShareSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearShareSelection = useCallback(() => setOverviewShareSelectedIds(new Set()), []);

  const startEditSelected = useCallback(() => {
    const [onlyId] = selectedIds;
    if (!onlyId) return;
    setEditingTicketId(onlyId);
    setSelectedIds(new Set());
    setPendingScrollToId(onlyId);
  }, [selectedIds]);

  const cancelEdit = useCallback((ticketId: string) => {
    setEditingTicketId((prev) => (prev === ticketId ? null : prev));
    delete draftEditsRef.current[ticketId];
  }, []);

  const setDraftField = useCallback((ticketId: string, field: string, value: string) => {
    if (!draftEditsRef.current[ticketId]) draftEditsRef.current[ticketId] = {};
    draftEditsRef.current[ticketId][field] = value;
  }, []);
  const getDraft = useCallback((ticketId: string) => draftEditsRef.current[ticketId], []);
  const clearDraft = useCallback((ticketId: string) => { delete draftEditsRef.current[ticketId]; }, []);

  // ---- notifications ----
  const sendNotification = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const { error } = await supabase.functions.invoke('bright-processor', { body: payload });
      if (error) console.error('bright-processor (email) function failed:', error);
    } catch (err) {
      console.error('bright-processor (email) call failed:', err);
    }
  }, [supabase]);

  const sendPushNotification = useCallback(async (payload: { ticket_number: string; address: string }) => {
    try {
      const { error } = await supabase.functions.invoke('send-push', {
        body: {
          title: 'Sesizare nouă',
          body: `${payload.ticket_number} — ${payload.address}`,
          url: 'admin-3.html?ticket=' + encodeURIComponent(payload.ticket_number),
        },
      });
      if (error) console.error('send-push failed:', error);
    } catch (err) {
      console.error('send-push call failed:', err);
    }
  }, [supabase]);

  // ---- mutations ----
  const saveTicketCard = useCallback(async (t: Ticket, payload: Record<string, unknown>, opts: { wasAwaitingReport: boolean; isNowAwaitingReport: boolean; resolver: string; addressVal: string }) => {
    const { error } = await supabase.from('tickets').update(payload).eq('id', t.id);
    if (error) {
      console.error(error);
      alert('Eroare la salvare. Încercați din nou.');
      return false;
    }
    setEditingTicketId((prev) => (prev === t.id ? null : prev));
    clearDraft(t.id);
    if (opts.isNowAwaitingReport && !opts.wasAwaitingReport) {
      sendNotification({
        type: 'report_needed',
        to: 'vlasbogdan@insta-grup.ro',
        ticket_number: t.ticket_number,
        address: opts.addressVal,
        closed_by: opts.resolver || '(nespecificat)',
        closed_on: (payload.resolved_on as string) ? new Date(payload.resolved_on as string).toLocaleDateString('ro-RO') : '—',
      });
    }
    showToast(`Tichetul ${t.ticket_number || ''} a fost salvat.`);
    await reload();
    return true;
  }, [supabase, clearDraft, sendNotification, reload]);

  const restoreTicket = useCallback(async (ticketId: string) => {
    const { error } = await supabase.from('tickets').update({ archived: false, archived_at: null }).eq('id', ticketId);
    if (error) { console.error(error); alert('Eroare la dezarhivare. Încercați din nou.'); return false; }
    await reload();
    return true;
  }, [supabase, reload]);

  const archiveSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const idsToArchive = new Set(selectedIds);
    selectedIds.forEach((id) => {
      const t = tickets.find((x) => x.id === id);
      if (!t) return;
      if (t.duplicate_of) {
        idsToArchive.add(t.duplicate_of);
        tickets.filter((d) => d.duplicate_of === t.duplicate_of).forEach((d) => idsToArchive.add(d.id));
      } else {
        tickets.filter((d) => d.duplicate_of === t.id).forEach((d) => idsToArchive.add(d.id));
      }
    });
    const addedCount = idsToArchive.size - selectedIds.size;
    const confirmMsg = addedCount > 0
      ? `Arhivați ${idsToArchive.size} tichete? (${selectedIds.size} selectate + ${addedCount} incluse automat ca să nu se rupă un grup de duplicate.) Nu vor mai apărea pe pagina publică de sesizări, dar rămân salvate și pot fi restaurate oricând.`
      : `Arhivați ${selectedIds.size} tichete? Nu vor mai apărea pe pagina publică de sesizări, dar rămân salvate și pot fi restaurate oricând.`;
    if (!confirm(confirmMsg)) return;
    const { error } = await supabase.from('tickets').update({ archived: true, archived_at: new Date().toISOString() }).in('id', Array.from(idsToArchive));
    if (error) { console.error(error); alert('Eroare la arhivare. Încercați din nou.'); return; }
    setSelectedIds(new Set());
    await reload();
  }, [supabase, selectedIds, tickets, reload]);

  const markDuplicates = useCallback(async (canonicalId: string, duplicateIds: string[]) => {
    return supabase.from('tickets').update({ duplicate_of: canonicalId }).in('id', duplicateIds);
  }, [supabase]);

  const unmarkDuplicate = useCallback(async (ticketId: string) => {
    if (!confirm('Anulezi legătura de duplicat? Sesizarea revine la starea pe care o avea înainte să fie marcată duplicat.')) return;
    const ticket = tickets.find((t) => t.id === ticketId);
    const restoredStatus = ticket ? (ticket.pre_duplicate_status || 'Ongoing') : 'Ongoing';
    const payload: Record<string, unknown> = { duplicate_of: null };
    if (restoredStatus !== 'Terminat') { payload.archived = false; payload.archived_at = null; }
    const { error } = await supabase.from('tickets').update(payload).eq('id', ticketId);
    if (error) { console.error(error); alert('Eroare la anularea duplicatului. Încercați din nou.'); return; }
    showToast('Legătura de duplicat a fost anulată.');
    await reload();
  }, [supabase, tickets, reload]);

  const createTicket = useCallback(async (input: { type: string; name: string; phone: string; email: string; address: string; description: string; dateVal: string; resolvedDateVal: string; resolvedByVal: string }) => {
    const { data: ticketNumber, error } = await supabase.rpc('create_ticket', {
      p_type: input.type, p_name: input.name, p_phone: input.phone,
      p_email: input.email || null, p_address: input.address, p_description: input.description || null,
    });
    if (error) {
      console.error(error);
      return { ok: false as const, error };
    }
    const notifyPayload = {
      type: 'ticket', ticket_number: ticketNumber,
      ticket_type: input.type === 'Anunt accident' ? 'Accident / urgență' : 'Defect',
      name: input.name, phone: input.phone, email: input.email || '-', address: input.address, description: input.description || '-',
    };
    sendNotification(notifyPayload);
    if (!input.resolvedDateVal) sendPushNotification({ ticket_number: ticketNumber as string, address: input.address });

    if (input.dateVal || input.resolvedDateVal) {
      const updatePayload: Record<string, unknown> = {};
      if (input.dateVal) updatePayload.submitted_on = new Date(`${input.dateVal}T${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`).toISOString();
      if (input.resolvedDateVal) {
        updatePayload.resolved_on = new Date(`${input.resolvedDateVal}T${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`).toISOString();
        updatePayload.status = 'Terminat';
        if (input.resolvedByVal) updatePayload.resolved_by = input.resolvedByVal;
      }
      const { error: dateError } = await supabase.from('tickets').update(updatePayload).eq('ticket_number', ticketNumber);
      if (dateError) console.error(dateError);
    }
    if (input.resolvedDateVal) {
      sendNotification({
        type: 'report_needed', to: 'vlasbogdan@insta-grup.ro', ticket_number: ticketNumber, address: input.address,
        closed_by: input.resolvedByVal || '(nespecificat)', closed_on: new Date(`${input.resolvedDateVal}T00:00`).toLocaleDateString('ro-RO'),
      });
    }
    showToast(`Sesizarea ${ticketNumber} a fost creată.`);
    await reload();
    return { ok: true as const, ticketNumber: ticketNumber as string };
  }, [supabase, sendNotification, sendPushNotification, reload]);

  // ---- goToTicket / deep-link ----
  const goToTicket = useCallback((ticketId: string) => {
    const targetTicket = tickets.find((t) => t.id === ticketId);
    if (!targetTicket) return;
    setOverviewReturnState(activeView === 'overview' ? {
      status: overviewStatusFilter, priority: overviewCardFilter, year: ticketYearFilter, month: ticketMonthFilter, ticketId,
    } : null);
    setAgingOnlyFilter(false);
    setTypeOnlyFilter(null);
    if (ticketSearchQuery.trim() && !matchesSearch(targetTicket, ticketSearchQuery.trim().toLowerCase())) {
      setTicketSearchQuery('');
    }
    if (!matchesYear(targetTicket, ticketYearFilter)) setTicketYearFilter('all');
    if (!matchesMonth(targetTicket, ticketMonthFilter)) setTicketMonthFilter('all');
    if (!ticketMatchesStatusFilter(targetTicket, activeFilter)) setTicketFilter('Toate');
    const targetView: ActiveTicketView = targetTicket.type === 'Anunt accident' ? 'tickets-accident' : 'tickets-functional';
    setActiveTypeFilter(targetTicket.type === 'Anunt accident' ? 'accident' : 'functional');
    setActiveView(targetView);
    window.openAdminTab?.(targetView);
    setJumpHighlightId(ticketId);
    setPendingScrollToId(ticketId);
    setTimeout(() => setJumpHighlightId((prev) => (prev === ticketId ? null : prev)), 1800);
  }, [tickets, activeView, overviewStatusFilter, overviewCardFilter, ticketYearFilter, ticketMonthFilter, ticketSearchQuery, activeFilter, setTicketFilter, setTicketYearFilter, setTicketMonthFilter]);

  const returnToOverviewTable = useCallback(() => {
    const state = overviewReturnState;
    setOverviewReturnState(null);
    if (!state) {
      window.openAdminTab?.('overview');
      return;
    }
    setTicketYearFilter(state.year);
    setTicketMonthFilter(state.month);
    setOverviewCardFilter(state.priority);
    setOverviewStatusFilter(state.status);
    window.openAdminTab?.('overview');
  }, [overviewReturnState, setTicketYearFilter, setTicketMonthFilter]);

  const goToTicketByNumber = useCallback((ticketNumber: string): boolean => {
    const match = tickets.find((t) => t.ticket_number === ticketNumber);
    if (!match) return false;
    goToTicket(match.id);
    return true;
  }, [tickets, goToTicket]);

  // Exposes a window bridge for admin-core.js's push-tap / service-worker
  // message handler and the ?ticket= URL param check, same contract the
  // vanilla version had.
  useEffect(() => {
    window.goToTicketByNumber = goToTicketByNumber;
    return () => { if (window.goToTicketByNumber === goToTicketByNumber) delete window.goToTicketByNumber; };
  }, [goToTicketByNumber]);

  // Eight more explicit window.* bridges, same pattern: search.js's smart-
  // search/command palette still calls bare `allTickets` (indexing
  // tickets by number/name/phone/address/email/description) and bare
  // `goToTicket(id)` (its "Vezi" result button); excel.js's Excel export
  // and repair-sheet import still read bare `allTickets` and
  // `ticketYearFilter` (to default the yearly report to whatever year is
  // currently selected), call bare `loadTickets()` once a repair-sheet
  // import is confirmed and saved (to refresh the list with the new
  // resolution notes), and call bare `getEffectiveMonthYear`/
  // `isDuplicateTicket`/`sortTicketsByNumber`/`getCanonicalTicket` while
  // building the yearly report and matching uploaded rows to tickets --
  // all classic-script globals, same contract tickets.js's own vanilla
  // copies used to provide. Kept in sync on every relevant change.
  // getCanonicalTicket's own vanilla copy took just the ticket (closing
  // over the shared `allTickets` global directly) rather than this
  // module's two-arg version (tickets array + ticket) -- same thing,
  // just wrapped to match the one-arg call shape excel.js still expects.
  useEffect(() => {
    window.allTickets = tickets;
    return () => { if (window.allTickets === tickets) delete window.allTickets; };
  }, [tickets]);
  useEffect(() => {
    window.goToTicket = goToTicket;
    return () => { if (window.goToTicket === goToTicket) delete window.goToTicket; };
  }, [goToTicket]);
  useEffect(() => {
    window.ticketYearFilter = ticketYearFilter;
    return () => { if (window.ticketYearFilter === ticketYearFilter) delete window.ticketYearFilter; };
  }, [ticketYearFilter]);
  useEffect(() => {
    window.loadTickets = reload;
    return () => { if (window.loadTickets === reload) delete window.loadTickets; };
  }, [reload]);
  useEffect(() => {
    window.getEffectiveMonthYear = getEffectiveMonthYear;
    return () => { if (window.getEffectiveMonthYear === getEffectiveMonthYear) delete window.getEffectiveMonthYear; };
  }, []);
  useEffect(() => {
    window.isDuplicateTicket = isDuplicateTicket;
    return () => { if (window.isDuplicateTicket === isDuplicateTicket) delete window.isDuplicateTicket; };
  }, []);
  useEffect(() => {
    window.sortTicketsByNumber = sortTicketsByNumber;
    return () => { if (window.sortTicketsByNumber === sortTicketsByNumber) delete window.sortTicketsByNumber; };
  }, []);
  const getCanonicalTicketBound = useCallback((t: Ticket | null | undefined) => getCanonicalTicket(tickets, t), [tickets]);
  useEffect(() => {
    window.getCanonicalTicket = getCanonicalTicketBound;
    return () => { if (window.getCanonicalTicket === getCanonicalTicketBound) delete window.getCanonicalTicket; };
  }, [getCanonicalTicketBound]);

  useEffect(() => {
    if (pendingTicketUrlParamHandled.current || loading || tickets.length === 0) return;
    pendingTicketUrlParamHandled.current = true;
    const ticketNum = new URLSearchParams(window.location.search).get('ticket');
    if (!ticketNum) return;
    goToTicketByNumber(ticketNum);
    window.history.replaceState({}, '', window.location.pathname + window.location.search.replace(/[?&]ticket=[^&]*/, '').replace(/^&/, '?'));
  }, [loading, tickets, goToTicketByNumber]);

  return {
    tickets, loading, reload, availableYears,
    activeFilter, setTicketFilter, activeTypeFilter, setActiveTypeFilter,
    agingOnlyFilter, typeOnlyFilter, clearNarrowFilter,
    ticketSearchQuery, setTicketSearchQuery,
    ticketYearFilter, setTicketYearFilter, ticketMonthFilter, setTicketMonthFilter,
    ticketYearFilterTouched, ticketMonthFilterTouched,
    overviewDayFilter, setOverviewDayFilter,
    overviewStatusFilter, setOverviewStatusFilter,
    overviewSearchQuery, setOverviewSearchQuery,
    overviewCardFilter, applyOverviewCardFilter, clearOverviewCardFilter,
    selectedIds, toggleSelected, clearSelection,
    overviewShareSelectedIds, toggleShareSelected, clearShareSelection,
    editingTicketId, startEditSelected, cancelEdit, setEditingTicketId,
    setDraftField, getDraft, clearDraft,
    activeView, overviewReturnState, jumpHighlightId, pendingScrollToId, setPendingScrollToId,
    addFormOpen, setAddFormOpen,
    duplicateSheet, setDuplicateSheet,
    getFilteredTicketsForSesizari,
    sendNotification, sendPushNotification,
    saveTicketCard, restoreTicket, archiveSelected, markDuplicates, unmarkDuplicate, createTicket,
    goToTicket, returnToOverviewTable, goToTicketByNumber,
  };
}

export type TicketsStore = ReturnType<typeof useTicketsStore>;
