import { HOME_CLOCK_DAY_NAMES, HOME_CLOCK_MONTH_NAMES, eventsOnDate, type CalendarEvent } from './calendarUtils';
import { EventListOrEmpty } from './EventCard';

export function CalendarDaySheet({
  open, dateKeyStr, calendarEvents, onClose, onAddEvent, onEventClick,
}: {
  open: boolean;
  dateKeyStr: string | null;
  calendarEvents: CalendarEvent[];
  onClose: () => void;
  onAddEvent: () => void;
  onEventClick: (e: CalendarEvent) => void;
}) {
  if (!open || !dateKeyStr) return null;
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const label = new Date(y, m - 1, d);
  const title = `${HOME_CLOCK_DAY_NAMES[label.getDay()]}, ${d} ${HOME_CLOCK_MONTH_NAMES[m - 1]} ${y}`;
  const events = eventsOnDate(calendarEvents, dateKeyStr);

  return (
    <div className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="calendarDaySheetTitle">
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div><h3 id="calendarDaySheetTitle">{title}</h3></div>
          <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
        </div>
        <div className="calendar-day-events">
          <EventListOrEmpty events={events} now={new Date()} onEventClick={onEventClick} emptyLabel="Nicio programare în această zi." />
        </div>
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={onAddEvent}>+ Eveniment nou</button>
        </div>
      </div>
    </div>
  );
}
