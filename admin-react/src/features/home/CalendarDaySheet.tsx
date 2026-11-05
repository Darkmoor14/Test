import { HOME_CLOCK_DAY_NAMES, HOME_CLOCK_MONTH_NAMES, eventsOnDate, type CalendarEvent } from './calendarUtils';
import { EventListOrEmpty } from './EventCard';
import { useModalSheet } from '../../lib/useModalSheet';

export function CalendarDaySheet({
  open, dateKeyStr, calendarEvents, now, onClose, onAddEvent, onEventClick,
}: {
  open: boolean;
  dateKeyStr: string | null;
  calendarEvents: CalendarEvent[];
  now: Date;
  onClose: () => void;
  onAddEvent: () => void;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const { panelRef, handleKeyDown, backdropOnClick } = useModalSheet({ open: open && !!dateKeyStr, onClose });

  if (!open || !dateKeyStr) return null;
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const label = new Date(y, m - 1, d);
  const title = `${HOME_CLOCK_DAY_NAMES[label.getDay()]}, ${d} ${HOME_CLOCK_MONTH_NAMES[m - 1]} ${y}`;
  const events = eventsOnDate(calendarEvents, dateKeyStr);

  return (
    <div id="calendarDaySheet" className="mobile-sheet show" aria-hidden="false" onKeyDown={handleKeyDown}>
      <div className="mobile-sheet-backdrop" onClick={backdropOnClick} />
      <div ref={panelRef} tabIndex={-1} className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="calendarDaySheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div><h3 id="calendarDaySheetTitle">{title}</h3></div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
          </div>
          <div className="calendar-day-events">
            <EventListOrEmpty events={events} now={now} onEventClick={onEventClick} emptyLabel="Nicio programare în această zi." />
          </div>
          <div className="sheet-actions">
            <button type="button" className="btn btn-primary" onClick={onAddEvent}>+ Eveniment nou</button>
          </div>
        </div>
      </div>
    </div>
  );
}
