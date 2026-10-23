import { Fragment, useMemo, useState } from 'react';
import { useTickets } from './TicketsContext';
import { useStaffRoster } from '../home/useStaffRoster';
import {
  AGING_THRESHOLD_DAYS, calendarDaysBetween, fmtDateOnly, formatDurationDays,
  getCanonicalTicket, isAwaitingReport, isDuplicateTicket, matchesMonth, matchesSearch, matchesYear, parseTicketDate,
} from './ticketUtils';
import type { Ticket } from './types';

function useOverviewVisibleTickets(): Ticket[] {
  const store = useTickets();
  return useMemo(() => {
    let visible = store.tickets.filter((t) =>
      matchesSearch(t, store.overviewSearchQuery.trim().toLowerCase()) &&
      matchesYear(t, store.ticketYearFilter) && matchesMonth(t, store.ticketMonthFilter));
    if (store.overviewDayFilter !== null) {
      visible = visible.filter((t) => {
        const d = parseTicketDate(t.submitted_on);
        return !isNaN(d.getTime()) && d.getDate() === store.overviewDayFilter;
      });
    }
    if (store.overviewStatusFilter === 'active') visible = visible.filter((t) => t.status !== 'Terminat');
    else if (store.overviewStatusFilter === 'done') visible = visible.filter((t) => t.status === 'Terminat');
    else if (store.overviewStatusFilter === 'awaiting_report') visible = visible.filter((t) => t.status === 'Terminat' && !t.resolution_note);

    if (store.overviewCardFilter === 'solved') {
      visible = visible.filter((t) => t.status === 'Terminat');
    } else if (store.overviewCardFilter === 'awaiting_report') {
      visible = visible.filter((t) => isAwaitingReport(t));
    } else if (store.overviewCardFilter) {
      visible = visible.filter((t) => t.status !== 'Terminat');
      if (store.overviewCardFilter === 'aging') {
        visible = visible.filter((t) => {
          if (!t.submitted_on) return false;
          const daysOpen = (Date.now() - parseTicketDate(t.submitted_on).getTime()) / 86400000;
          return daysOpen > AGING_THRESHOLD_DAYS;
        });
      } else if (store.overviewCardFilter === 'functional') visible = visible.filter((t) => t.type !== 'Anunt accident');
      else if (store.overviewCardFilter === 'accident') visible = visible.filter((t) => t.type === 'Anunt accident');
    }
    return [...visible].sort((a, b) => (b.ticket_number || '').localeCompare(a.ticket_number || '', undefined, { numeric: true }));
  }, [store.tickets, store.overviewSearchQuery, store.ticketYearFilter, store.ticketMonthFilter, store.overviewDayFilter, store.overviewStatusFilter, store.overviewCardFilter]);
}

export function OverviewTable({ sessionEmail }: { sessionEmail: string | null }) {
  const store = useTickets();
  const { isGod, modulePermission } = useStaffRoster(sessionEmail);
  const canWriteTickets = isGod || modulePermission('tickets') === 'write';
  const ordered = useOverviewVisibleTickets();
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const toggleNote = (id: string) => setExpandedNoteIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (ordered.length === 0) {
    return (
      <div className="overview-table-wrap">
        <div className="overview-table-scroll">
          <table className="overview-table">
            <tbody><tr><td className="overview-empty">Nicio sesizare de afișat.</td></tr></tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="overview-table-wrap">
      <div className="overview-table-scroll">
      <table className="overview-table">
        <colgroup>
          <col className="col-num" /><col className="col-date" /><col className="col-type" />
          <col className="col-name" /><col className="col-phone" /><col className="col-address" />
          <col className="col-status" /><col className="col-resolved" /><col className="col-duration" />
        </colgroup>
        <thead>
          <tr>
            <th>Nr. sesizare</th><th>Data sesizării</th><th>Tip sesizare</th>
            <th>Nume reclamant</th><th>Telefon</th><th>Adresă identificare loc defect</th>
            <th>Stare sesizare</th><th>Data soluționării</th><th>Timp de soluționare</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((t) => {
            const isDone = t.status === 'Terminat';
            const isFullyComplete = !canWriteTickets ? isDone : (isDone && !!t.resolution_note);
            const isUrgent = t.type === 'Anunt accident';
            const isDuplicate = isDuplicateTicket(t);
            const canonicalTicket = getCanonicalTicket(store.tickets, t);
            const daysOpen = t.submitted_on ? (Date.now() - parseTicketDate(t.submitted_on).getTime()) / 86400000 : 0;
            const isAging = !isDone && daysOpen > AGING_THRESHOLD_DAYS;
            const resolutionDays = (isDone && t.resolved_on && t.submitted_on) ? calendarDaysBetween(t.submitted_on, t.resolved_on) : null;
            const noteExpanded = expandedNoteIds.has(t.id);
            return (
              <Fragment key={t.id}>
                <tr className={`${isFullyComplete ? 'done-row' : ''} ${isUrgent && !isDone ? 'urgent-row' : ''} ${isDuplicate ? 'duplicate-row' : ''}`}>
                  <td className="overview-ticket-num"><a href="#" className="ticket-link" onClick={(e) => { e.preventDefault(); store.goToTicket(t.id); }}>{t.ticket_number || '—'}</a></td>
                  <td className={isAging ? 'aging-date' : ''} title={isAging ? `Deschis de peste ${AGING_THRESHOLD_DAYS} zile` : ''}>{isAging ? '⚠ ' : ''}{fmtDateOnly(t.submitted_on)}</td>
                  <td>{isUrgent ? 'Accident' : 'Defect'}</td>
                  <td className="overview-name-cell" title={t.name || ''}>{t.name || '—'}</td>
                  <td>{t.phone || '—'}</td>
                  <td className="overview-address-cell">{t.address || '—'}</td>
                  <td><span className={`status-pill ${isDone ? 'status-pill-done' : 'status-pill-active'}`}>{isDone ? 'Soluționat' : 'În curs'}</span></td>
                  {isDuplicate ? (
                    <>
                      <td><span className="duplicate-badge">Duplicat</span></td>
                      <td>{canonicalTicket ? <a href="#" className="ticket-link" title="Mergi la sesizarea originală" onClick={(e) => { e.preventDefault(); store.goToTicket(canonicalTicket.id); }}>{canonicalTicket.ticket_number || '—'}</a> : '—'}</td>
                    </>
                  ) : (
                    <>
                      <td>{isDone ? <span className="resolved-date-toggle" title="Vezi ce s-a făcut" onClick={() => toggleNote(t.id)}>{fmtDateOnly(t.resolved_on)}</span> : '—'}</td>
                      <td>{resolutionDays !== null ? formatDurationDays(resolutionDays) : '—'}</td>
                    </>
                  )}
                </tr>
                {isDone && noteExpanded && (
                  <tr className="resnote-expand-row">
                    <td colSpan={9}><strong>Ce s-a făcut:</strong> {t.resolution_note || <em>Nu a fost completat încă.</em>}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export function OverviewCardsMobile() {
  const store = useTickets();
  const ordered = useOverviewVisibleTickets();
  if (ordered.length === 0) return <div className="overview-cards-mobile"><div className="overview-empty">Nicio sesizare de afișat.</div></div>;
  return (
    <div className="overview-cards-mobile">
      {ordered.map((t) => {
        const isDone = t.status === 'Terminat';
        const isUrgent = t.type === 'Anunt accident';
        const isDuplicate = isDuplicateTicket(t);
        const canonicalTicket = getCanonicalTicket(store.tickets, t);
        const daysOpen = t.submitted_on ? (Date.now() - parseTicketDate(t.submitted_on).getTime()) / 86400000 : 0;
        const isAging = !isDone && daysOpen > AGING_THRESHOLD_DAYS;
        const selected = store.overviewShareSelectedIds.has(t.id);
        return (
          <button
            key={t.id} type="button"
            className={`ov-card ${isDone ? 'done' : ''} ${isUrgent && !isDone ? 'urgent' : ''} ${isDuplicate ? 'duplicate' : ''}`}
            onClick={() => store.goToTicket(t.id)}
          >
            <div className="ov-card-top">
              <span className={`status-bubble ${isDone ? 'done' : 'active'}`} />
              <span className="ov-card-type">{isUrgent ? 'Accident' : 'Defect'}</span>
              <span className="ov-card-num">{t.ticket_number || '—'}</span>
              {isDuplicate && <span className="duplicate-badge">Duplicat</span>}
              <span
                className={`ov-card-share ${selected ? 'selected' : ''}`} role="checkbox" aria-checked={selected} aria-label="Selectează pentru trimitere"
                onClick={(e) => { e.stopPropagation(); store.toggleShareSelected(t.id); }}
              >
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
              </span>
            </div>
            <div className="ov-card-address">{t.address || '—'}</div>
            <div className="ov-card-meta">
              <span className={isAging ? 'aging' : ''}>{isAging ? '⚠ ' : ''}{fmtDateOnly(t.submitted_on)}</span>
              <span>{t.name || '—'} · {t.phone || '—'}</span>
            </div>
            {isDuplicate ? (
              <div className="ov-card-resolved duplicate-link-note" onClick={(e) => { if (canonicalTicket) { e.stopPropagation(); store.goToTicket(canonicalTicket.id); } }}>
                Duplicat al {canonicalTicket ? (canonicalTicket.ticket_number || '—') : '—'}{canonicalTicket ? ' — Mergi la original' : ''}
              </div>
            ) : isDone ? (
              <div
                className="ov-card-resolved resolved-date-toggle-mobile"
                onClick={(e) => {
                  e.stopPropagation();
                  const el = document.getElementById('resnote-mobile-' + t.id);
                  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                }}
              >
                Soluționat: {fmtDateOnly(t.resolved_on)}
              </div>
            ) : null}
            {isDone && !isDuplicate && (
              <div id={'resnote-mobile-' + t.id} className="resnote-expand-mobile" style={{ display: 'none' }}>
                <strong>Ce s-a făcut:</strong> {t.resolution_note || <em>Nu a fost completat încă.</em>}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
