import { useState } from 'react';
import { dateKey, eventsByDateInRange, HOME_CLOCK_MONTH_NAMES, type CalendarEvent } from './calendarUtils';

const MAX_CHIPS = 3;

export function FullMonthCalendar({
  open, calendarEvents, onClose, onDayClick, onEventClick, onAddEvent,
}: {
  open: boolean;
  calendarEvents: CalendarEvent[];
  onClose: () => void;
  onDayClick: (dateKeyStr: string) => void;
  onEventClick: (e: CalendarEvent) => void;
  onAddEvent: (defaultDateKey: string) => void;
}) {
  const today0 = new Date();
  const [year, setYear] = useState(today0.getFullYear());
  const [monthIdx, setMonthIdx] = useState(today0.getMonth());

  if (!open) return null;

  const todayKey = dateKey(new Date());
  const firstOfMonth = new Date(year, monthIdx, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, monthIdx, 0).getDate();
  const trailing = (7 - ((startOffset + daysInMonth) % 7)) % 7;

  interface Cell { key: string; dNum: number; outside: boolean; }
  const cells: Cell[] = [];
  for (let i = 0; i < startOffset; i++) {
    const prevMonth = monthIdx === 0 ? 11 : monthIdx - 1;
    const prevYear = monthIdx === 0 ? year - 1 : year;
    const dNum = daysInPrevMonth - startOffset + i + 1;
    cells.push({ key: `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`, dNum, outside: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ key: `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, dNum: d, outside: false });
  }
  for (let i = 1; i <= trailing; i++) {
    const nextMonth = monthIdx === 11 ? 0 : monthIdx + 1;
    const nextYear = monthIdx === 11 ? year + 1 : year;
    cells.push({ key: `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`, dNum: i, outside: true });
  }

  const gridStart = new Date(year, monthIdx, 1 - startOffset);
  const gridEnd = new Date(year, monthIdx, daysInMonth + trailing, 23, 59, 59);
  const eventsByDate = eventsByDateInRange(calendarEvents, gridStart, gridEnd);

  const goPrev = () => { if (monthIdx === 0) { setMonthIdx(11); setYear(year - 1); } else setMonthIdx(monthIdx - 1); };
  const goNext = () => { if (monthIdx === 11) { setMonthIdx(0); setYear(year + 1); } else setMonthIdx(monthIdx + 1); };
  const goToday = () => { setYear(today0.getFullYear()); setMonthIdx(today0.getMonth()); };

  return (
    <div id="homeFullMonthSheet" className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="homeFullMonthSheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-head">
            <div><h3 id="homeFullMonthSheetTitle">Calendar — lună completă</h3></div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
          </div>
          <div className="home-full-cal">
            <div className="home-full-cal-head">
              <button type="button" className="home-full-cal-nav" aria-label="Luna anterioară" onClick={goPrev}>‹</button>
              <span className="home-full-cal-month">{HOME_CLOCK_MONTH_NAMES[monthIdx]} {year}</span>
              <button type="button" className="home-full-cal-nav" aria-label="Luna următoare" onClick={goNext}>›</button>
              <button type="button" className="btn" onClick={goToday}>Astăzi</button>
              <button type="button" className="btn btn-primary" onClick={() => onAddEvent(todayKey)}>+ Eveniment</button>
            </div>
            <div className="home-full-cal-weekdays">
              <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
            </div>
            <div className="home-full-cal-grid">
              {cells.map((cell, i) => {
                const dayEvents = eventsByDate.get(cell.key) || [];
                const shown = dayEvents.slice(0, MAX_CHIPS);
                const extra = dayEvents.length - shown.length;
                return (
                  <button
                    type="button" key={`${cell.key}-${i}`}
                    className={`home-full-cal-day${cell.outside ? ' outside' : ''}${cell.key === todayKey ? ' today' : ''}`}
                    onClick={() => onDayClick(cell.key)}
                  >
                    <span className="home-full-cal-day-num">{cell.dNum}</span>
                    <span className="home-full-cal-day-chips">
                      {shown.map((e) => (
                        <span
                          key={e.id + e.start_time} className="home-full-cal-chip" title={e.title}
                          onClick={(ev) => { ev.stopPropagation(); onEventClick(e); }}
                        >
                          {(e.recurrence_freq || e.is_recurring_occurrence) ? '🔁 ' : ''}{e.title}
                        </span>
                      ))}
                      {extra > 0 && <span className="home-full-cal-chip-more">+{extra} mai multe</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
