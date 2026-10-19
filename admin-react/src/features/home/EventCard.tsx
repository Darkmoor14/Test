import { pad2 } from '../../lib/format';
import { isEventHappeningNow, type CalendarEvent } from './calendarUtils';

export function EventCard({ event, now, onClick }: { event: CalendarEvent; now: Date; onClick: () => void }) {
  const start = new Date(event.start_time);
  const timeLabel = event.all_day ? 'Toată ziua' : `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
  const active = isEventHappeningNow(event, now);
  const recurIcon = event.recurrence_freq || event.is_recurring_occurrence ? '🔁 ' : '';
  return (
    <div className={`calendar-day-event${active ? ' happening-now' : ''}`} onClick={onClick}>
      <div>
        <div className="calendar-day-event-title">{recurIcon}{event.title}</div>
        {event.location && <div className="calendar-day-event-meta">📍 {event.location}</div>}
        {event.description && <div className="calendar-day-event-meta">{event.description}</div>}
        {Array.isArray(event.attendees) && event.attendees.length > 0 && (
          <div className="calendar-day-event-meta">👤 {event.attendees.join(', ')}</div>
        )}
      </div>
      <span className="calendar-day-event-time">{timeLabel}</span>
    </div>
  );
}

export function EventListOrEmpty({ events, now, onEventClick, emptyLabel }: { events: CalendarEvent[]; now: Date; onEventClick: (e: CalendarEvent) => void; emptyLabel: string }) {
  if (events.length === 0) {
    return <div className="calendar-day-events-empty">{emptyLabel}</div>;
  }
  return (
    <>
      {events.map((e) => (
        <EventCard key={e.id} event={e} now={now} onClick={() => onEventClick(e)} />
      ))}
    </>
  );
}
