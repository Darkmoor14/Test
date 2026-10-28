import { useMemo, useState } from 'react';
import { dateKey, eventsOnDate, isEventVisibleTo, type CalendarEvent } from './calendarUtils';
import { useCalendarEvents } from './useCalendarEvents';
import { useStaffRoster } from './useStaffRoster';
import { useReminders } from './useReminders';
import { useNow } from './useNow';
import { HomeClock } from './HomeClock';
import { MiniCalendar } from './MiniCalendar';
import { FullMonthCalendar } from './FullMonthCalendar';
import { EventListOrEmpty } from './EventCard';
import { CalendarDaySheet } from './CalendarDaySheet';
import { CalendarEventFormSheet } from './CalendarEventFormSheet';
import { TodoWidget } from './TodoWidget';
import { NavGrid, type HomeNavKey } from './NavGrid';

export function HomePage({ sessionEmail, onNavigate }: { sessionEmail: string | null; onNavigate: (key: HomeNavKey) => void }) {
  const { events, saveEvent, deleteEvent } = useCalendarEvents(sessionEmail);
  const { isGod, modulePermission, allStaffEmails } = useStaffRoster(sessionEmail);
  // A no-invitees event is private to whoever created it; adding
  // invitees shares it with exactly those people plus the creator.
  // Filtered once here so every view (mini calendar, full month,
  // day sheets, De făcut, reminders) agrees on what "visible" means.
  const visibleEvents = useMemo(
    () => events.filter((e) => isEventVisibleTo(e, sessionEmail)),
    [events, sessionEmail],
  );
  useReminders(visibleEvents);
  const now = useNow();

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formEvent, setFormEvent] = useState<CalendarEvent | null>(null);
  const [formDefaultDate, setFormDefaultDate] = useState<string>(dateKey(new Date()));
  const [fullMonthOpen, setFullMonthOpen] = useState(false);

  const openDay = (key: string) => { setSelectedDay(key); setDaySheetOpen(true); };
  const openNewEvent = (defaultDate: string) => { setFormEvent(null); setFormDefaultDate(defaultDate); setFormOpen(true); };
  const openEditEvent = (e: CalendarEvent) => { setFormEvent(e); setFormDefaultDate(dateKey(new Date(e.start_time))); setFormOpen(true); };

  const openDayFromFullMonth = (key: string) => { setFullMonthOpen(false); openDay(key); };
  const openEditEventFromFullMonth = (e: CalendarEvent) => { setFullMonthOpen(false); openEditEvent(e); };
  const openNewEventFromFullMonth = (defaultDate: string) => { setFullMonthOpen(false); openNewEvent(defaultDate); };

  const todayEvents = eventsOnDate(visibleEvents, dateKey(new Date()));

  const visibility: Record<HomeNavKey, boolean> = {
    tickets: isGod || modulePermission('tickets') === 'write',
    projects: isGod || modulePermission('proiecte') === 'write',
    erp: isGod || modulePermission('erp') === 'write',
    hr: isGod || modulePermission('hr') === 'write',
    docs: isGod || modulePermission('docs') === 'write',
    status: isGod,
  };

  return (
    <>
      <div className="home-start-grid">
        <div className="home-clock-card">
          <HomeClock />
          <MiniCalendar calendarEvents={visibleEvents} onDayClick={openDay} />
          <button type="button" className="home-mini-cal-expand-link" onClick={() => setFullMonthOpen(true)}>Vezi luna completă →</button>
          <div className="home-cal-today">
            <span className="k">Astăzi</span>
            <div className="calendar-day-events">
              <EventListOrEmpty events={todayEvents} now={now} onEventClick={openEditEvent} emptyLabel="Nicio programare azi." />
            </div>
          </div>
          <button type="button" className="btn home-cal-add-btn" onClick={() => openNewEvent(dateKey(new Date()))}>+ Eveniment</button>
        </div>
        <div className="home-start-main">
          <div className="home-intro">
            <div><div className="home-eyebrow">Acasă</div><h2>Bine ai revenit.</h2></div>
          </div>
          <NavGrid visibility={visibility} onNavigate={onNavigate} />
        </div>
        <TodoWidget calendarEvents={visibleEvents} onLinkedEventClick={openEditEvent} />
      </div>

      <CalendarDaySheet
        open={daySheetOpen}
        dateKeyStr={selectedDay}
        calendarEvents={visibleEvents}
        now={now}
        onClose={() => setDaySheetOpen(false)}
        onAddEvent={() => openNewEvent(selectedDay || dateKey(new Date()))}
        onEventClick={openEditEvent}
      />
      <CalendarEventFormSheet
        open={formOpen}
        event={formEvent}
        defaultDateKey={formDefaultDate}
        allStaffEmails={allStaffEmails}
        onClose={() => setFormOpen(false)}
        onSave={saveEvent}
        onDelete={deleteEvent}
      />
      <FullMonthCalendar
        open={fullMonthOpen}
        calendarEvents={visibleEvents}
        onClose={() => setFullMonthOpen(false)}
        onDayClick={openDayFromFullMonth}
        onEventClick={openEditEventFromFullMonth}
        onAddEvent={openNewEventFromFullMonth}
      />
    </>
  );
}
