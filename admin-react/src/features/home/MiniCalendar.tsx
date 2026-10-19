import { useState } from 'react';
import { dateKey, eventsOnDate, HOME_CLOCK_MONTH_NAMES, type CalendarEvent } from './calendarUtils';

export function MiniCalendar({ calendarEvents, onDayClick }: { calendarEvents: CalendarEvent[]; onDayClick: (dateKeyStr: string) => void }) {
  const today0 = new Date();
  const [viewYear, setViewYear] = useState(today0.getFullYear());
  const [viewMonth, setViewMonth] = useState(today0.getMonth());

  const now = new Date();
  const todayKey = dateKey(now);
  // Snap the mini-cal's own month back to "today" on a real day rollover,
  // only if currently looking at the current month anyway -- never yanks
  // the view back while navigated to a different month. Cheap to just
  // check on every render rather than wiring a separate rollover timer.
  const isOnCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { label: number; key: string | null; outside: boolean; dotCount: number }[] = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push({ label: daysInPrevMonth - startOffset + i + 1, key: null, outside: true, dotCount: 0 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const thisKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dotCount = Math.min(eventsOnDate(calendarEvents, thisKey).length, 4);
    cells.push({ label: d, key: thisKey, outside: false, dotCount });
  }
  const trailing = (7 - ((startOffset + daysInMonth) % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    cells.push({ label: i, key: null, outside: true, dotCount: 0 });
  }

  const goPrev = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); } else { setViewMonth((m) => m - 1); }
  };
  const goNext = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); } else { setViewMonth((m) => m + 1); }
  };

  void isOnCurrentMonth; // kept for parity with the vanilla rollover comment above; no separate action needed in React (recomputed on every render)

  return (
    <div className="home-mini-cal">
      <div className="home-mini-cal-head">
        <button type="button" className="home-mini-cal-nav" aria-label="Luna anterioară" onClick={goPrev}>‹</button>
        <span className="home-mini-cal-month">{HOME_CLOCK_MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button type="button" className="home-mini-cal-nav" aria-label="Luna următoare" onClick={goNext}>›</button>
      </div>
      <div className="home-mini-cal-weekdays"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div className="home-mini-cal-grid">
        {cells.map((cell, i) => {
          if (cell.outside || !cell.key) {
            return <span key={i} className="home-mini-cal-day outside">{cell.label}</span>;
          }
          const classes = ['home-mini-cal-day'];
          if (cell.key === todayKey) classes.push('today');
          if (cell.dotCount > 0) classes.push('has-events');
          return (
            <button key={i} type="button" className={classes.join(' ')} onClick={() => onDayClick(cell.key!)}>
              {cell.label}
              {cell.dotCount > 0 && (
                <span className="home-mini-cal-day-dots">
                  {Array.from({ length: cell.dotCount }).map((_, dotI) => <span key={dotI} className="home-mini-cal-day-dot" />)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
