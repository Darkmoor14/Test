import { useState } from 'react';
import { useProjects } from './ProjectsContext';
import { HOME_CLOCK_MONTH_NAMES, dateKey, formatWoDateRO } from './projectUtils';
import type { WorkOrder } from './types';

const MAX_CHIPS = 3;

export function WorkOrdersCalendar() {
  const store = useProjects();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth());

  const ordersOnDate = (dateKeyStr: string): WorkOrder[] =>
    store.workOrders.filter((w) => {
      const start = w.scheduled_date;
      const end = w.scheduled_end_date || w.scheduled_date;
      return start && dateKeyStr >= start && dateKeyStr <= end;
    });

  const todayKey = dateKey(new Date());
  const firstOfMonth = new Date(year, monthIdx, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, monthIdx, 0).getDate();

  interface Cell { key: string; dNum: number; outside: boolean; orders: WorkOrder[]; }
  const cells: Cell[] = [];
  for (let i = 0; i < startOffset; i++) {
    const prevMonth = monthIdx === 0 ? 11 : monthIdx - 1;
    const prevYear = monthIdx === 0 ? year - 1 : year;
    const dNum = daysInPrevMonth - startOffset + i + 1;
    cells.push({ key: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`, dNum, outside: true, orders: [] });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const thisKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ key: thisKey, dNum: d, outside: false, orders: ordersOnDate(thisKey) });
  }
  const trailing = (7 - ((startOffset + daysInMonth) % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const nextMonth = monthIdx === 11 ? 0 : monthIdx + 1;
    const nextYear = monthIdx === 11 ? year + 1 : year;
    cells.push({ key: `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`, dNum: i, outside: true, orders: [] });
  }

  const goPrev = () => { if (monthIdx === 0) { setMonthIdx(11); setYear(year - 1); } else setMonthIdx(monthIdx - 1); };
  const goNext = () => { if (monthIdx === 11) { setMonthIdx(0); setYear(year + 1); } else setMonthIdx(monthIdx + 1); };
  const goToday = () => { setYear(now.getFullYear()); setMonthIdx(now.getMonth()); };
  const download = () => {
    document.body.classList.add('print-calendar-only');
    window.print();
    window.addEventListener('afterprint', () => document.body.classList.remove('print-calendar-only'), { once: true });
  };

  return (
    <div className="wo-calendar">
      <div className="wo-calendar-head">
        <button type="button" className="wo-cal-nav" aria-label="Luna anterioară" onClick={goPrev}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="wo-calendar-month">{HOME_CLOCK_MONTH_NAMES[monthIdx]} {year}</span>
        <button type="button" className="wo-cal-nav" aria-label="Luna următoare" onClick={goNext}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
        <button type="button" className="btn" onClick={goToday}>Azi</button>
        <button type="button" className="btn" onClick={download} title="Descarcă / printează calendarul">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-2px', marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Descarcă
        </button>
      </div>
      <div className="wo-calendar-weekdays"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div className="wo-calendar-grid">
        {cells.map((cell, i) => {
          const shown = cell.orders.slice(0, MAX_CHIPS);
          const extra = cell.orders.length - shown.length;
          return (
            <button
              type="button" key={`${cell.key}-${i}`}
              className={`wo-cal-day${cell.outside ? ' outside' : ''}${cell.key === todayKey ? ' today' : ''}`}
              onClick={() => store.openWorkOrderForm(null, cell.key)}
            >
              <span className="wo-cal-day-num">{cell.dNum}</span>
              <span className="wo-cal-day-chips">
                {shown.map((w) => (
                  <span
                    key={w.id} className={`wo-cal-chip status-${w.status.replace(/\s+/g, '-')}`} title={w.title}
                    onClick={(e) => { e.stopPropagation(); store.openWorkOrderForm(w); }}
                  >{w.title}</span>
                ))}
                {extra > 0 && <span className="wo-cal-chip-more">+{extra} mai multe</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { formatWoDateRO };
