import { useEffect, useState } from 'react';
import { MINI_CAL_MONTH_NAMES } from './ticketUtils';

export function MiniDayCalendar({
  year, month, day, setYear, setMonth, setDay, onPicked,
}: {
  year: string; month: string; day: number | null;
  setYear: (v: string) => void; setMonth: (v: string) => void; setDay: (v: number | null) => void;
  onPicked: () => void;
}) {
  const now = new Date();
  const initialYear = Number(year);
  const initialMonth = Number(month);
  const [viewYear, setViewYear] = useState(Number.isFinite(initialYear) ? initialYear : now.getFullYear());
  const [viewMonth, setViewMonth] = useState(Number.isFinite(initialMonth) ? initialMonth : now.getMonth() + 1);

  // Keep the calendar's own displayed month roughly in sync when the
  // year/month filter changes from elsewhere (e.g. a select dropdown).
  useEffect(() => {
    const y = Number(year), m = Number(month);
    if (Number.isFinite(y)) setViewYear(y);
    if (Number.isFinite(m)) setViewMonth(m);
  }, [year, month]);

  const isWholeMonthSelected = day === null && String(year) === String(viewYear) && String(month) === String(viewMonth);

  const firstOfMonth = new Date(viewYear, viewMonth - 1, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth - 1, 0).getDate();
  const isCurrentMonth = now.getFullYear() === viewYear && now.getMonth() + 1 === viewMonth;

  const cells: { label: number; outside: boolean; day?: number }[] = [];
  for (let i = 0; i < startOffset; i++) cells.push({ label: daysInPrevMonth - startOffset + i + 1, outside: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ label: d, outside: false, day: d });
  const trailing = (7 - ((startOffset + daysInMonth) % 7)) % 7;
  for (let i = 1; i <= trailing; i++) cells.push({ label: i, outside: true });

  const pickDay = (d: number) => {
    setDay(d);
    setYear(String(viewYear));
    setMonth(String(viewMonth));
    onPicked();
  };

  const toggleWholeMonth = () => {
    if (isWholeMonthSelected) {
      setYear('all'); setMonth('all'); setDay(null);
    } else {
      setYear(String(viewYear)); setMonth(String(viewMonth)); setDay(null);
    }
    onPicked();
  };

  return (
    <div className="sheet-mini-calendar popover-daygrid">
      <div className="mini-cal-header">
        <button type="button" aria-label="Luna anterioară" onClick={() => { setViewMonth((m) => (m === 1 ? (setViewYear((y) => y - 1), 12) : m - 1)); }}>‹</button>
        <button
          type="button"
          className="mini-cal-month-label"
          title={isWholeMonthSelected ? 'Șterge filtrul de lună — arată toate lunile' : `Selectează toată luna ${MINI_CAL_MONTH_NAMES[viewMonth - 1]} ${viewYear}`}
          onClick={(e) => { e.stopPropagation(); toggleWholeMonth(); }}
        >
          {MINI_CAL_MONTH_NAMES[viewMonth - 1]} {viewYear}
        </button>
        <button type="button" aria-label="Luna următoare" onClick={() => { setViewMonth((m) => (m === 12 ? (setViewYear((y) => y + 1), 1) : m + 1)); }}>›</button>
      </div>
      <div className="mini-cal-weekdays"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div className="mini-cal-grid">
        {cells.map((c, i) => {
          if (c.outside || c.day === undefined) return <span key={i} className="mini-cal-day outside">{c.label}</span>;
          const classes = ['mini-cal-day'];
          if (isCurrentMonth && c.day === now.getDate()) classes.push('today');
          if (day === c.day && String(year) === String(viewYear) && String(month) === String(viewMonth)) classes.push('selected');
          return <button key={i} type="button" className={classes.join(' ')} onClick={() => pickDay(c.day!)}>{c.day}</button>;
        })}
      </div>
      <button type="button" className={`mini-cal-clear-btn${day !== null ? ' active-filter' : ''}`} onClick={() => { setDay(null); onPicked(); }}>Toate zilele</button>
    </div>
  );
}
