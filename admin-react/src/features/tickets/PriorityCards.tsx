import { useMemo } from 'react';
import { useTickets } from './TicketsContext';
import { AGING_THRESHOLD_DAYS, isDuplicateTicket, parseTicketDate } from './ticketUtils';

// The 4 cards at the top of "Prezentare generală" -- deliberately
// ignore whichever year is selected in the table below: these answer
// "what needs attention right now".
export function PriorityCards() {
  const store = useTickets();
  const stats = useMemo(() => {
    const active = store.tickets.filter((t) => !t.archived && t.status !== 'Terminat' && !isDuplicateTicket(t));
    const agingCount = active.filter((t) => {
      if (!t.submitted_on) return false;
      const daysOpen = (Date.now() - parseTicketDate(t.submitted_on).getTime()) / 86400000;
      return daysOpen > AGING_THRESHOLD_DAYS;
    }).length;
    const accidentCount = active.filter((t) => t.type === 'Anunt accident').length;
    const funcCount = active.length - accidentCount;
    const solvedCount = store.tickets.filter((t) => t.status === 'Terminat' && !isDuplicateTicket(t)).length;
    return { activeCount: active.length, agingCount, accidentCount, funcCount, solvedCount };
  }, [store.tickets]);

  return (
    <div className="priority-grid">
      <button type="button" className="priority-card" onClick={() => store.applyOverviewCardFilter('active')}>
        <span className="k">● Active</span>
        <div className="num">{stats.activeCount}</div>
        <div className="sub">Sesizări încă nesoluționate</div>
      </button>
      <button type="button" className="priority-card warn" onClick={() => store.applyOverviewCardFilter('aging')}>
        <span className="k">⚠ Peste 7 zile</span>
        <div className="num">{stats.agingCount}</div>
        <div className="sub">Active de prea mult timp</div>
      </button>
      <button type="button" className="priority-card" onClick={() => store.applyOverviewCardFilter('functional')}>
        <span className="k">● Defecte</span>
        <div className="num">{stats.funcCount}</div>
        <div className="sub">Sesizări active, fără pericol iminent</div>
      </button>
      <button type="button" className="priority-card danger" onClick={() => store.applyOverviewCardFilter('accident')}>
        <span className="k">⛔ Accidente</span>
        <div className="num">{stats.accidentCount}</div>
        <div className="sub">Urgențe active — pericol iminent</div>
      </button>
      <button type="button" className="priority-card done" onClick={() => store.applyOverviewCardFilter('solved')}>
        <span className="k">✓ Soluționate</span>
        <div className="num">{stats.solvedCount}</div>
        <div className="sub">Sesizări soluționate, cu sau fără raport</div>
      </button>
    </div>
  );
}
