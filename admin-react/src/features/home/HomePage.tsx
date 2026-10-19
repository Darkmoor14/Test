import { useState } from 'react';
import { dateKey, eventsOnDate, type CalendarEvent } from './calendarUtils';
import { useCalendarEvents } from './useCalendarEvents';
import { useStaffRoster } from './useStaffRoster';
import { useReminders } from './useReminders';
import { HomeClock } from './HomeClock';
import { MiniCalendar } from './MiniCalendar';
import { EventListOrEmpty } from './EventCard';
import { CalendarDaySheet } from './CalendarDaySheet';
import { CalendarEventFormSheet } from './CalendarEventFormSheet';
import { TodoWidget } from './TodoWidget';
import { NavGrid, type HomeNavKey } from './NavGrid';

export function HomePage({ sessionEmail, onNavigate }: { sessionEmail: string | null; onNavigate: (key: HomeNavKey) => void }) {
  const { events, saveEvent, deleteEvent } = useCalendarEvents(sessionEmail);
  const { isGod, modulePermission, allStaffEmails } = useStaffRoster(sessionEmail);
  useReminders(events);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formEvent, setFormEvent] = useState<CalendarEvent | null>(null);
  const [formDefaultDate, setFormDefaultDate] = useState<string>(dateKey(new Date()));

  const openDay = (key: string) => { setSelectedDay(key); setDaySheetOpen(true); };
  const openNewEvent = (defaultDate: string) => { setFormEvent(null); setFormDefaultDate(defaultDate); setFormOpen(true); };
  const openEditEvent = (e: CalendarEvent) => { setFormEvent(e); setFormDefaultDate(dateKey(new Date(e.start_time))); setFormOpen(true); };

  const todayEvents = eventsOnDate(events, dateKey(new Date()));

  const visibility: Record<HomeNavKey, boolean> = {
    tickets: isGod || modulePermission('tickets') === 'write',
    projects: isGod || modulePermission('proiecte') === 'write',
    erp: isGod || modulePermission('erp') === 'write',
    hr: isGod || modulePermission('hr') === 'write',
    docs: isGod || modulePermission('hr') === 'write',
    status: isGod,
  };

  return (
    <div className="admin-panel active" id="panel-home">
      <div className="home-start-grid">
        <div className="home-clock-card">
          <HomeClock />
          <MiniCalendar calendarEvents={events} onDayClick={openDay} />
          <div className="home-cal-today">
            <span className="k">Astăzi</span>
            <div className="calendar-day-events">
              <EventListOrEmpty events={todayEvents} now={new Date()} onEventClick={openEditEvent} emptyLabel="Nicio programare azi." />
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
        <TodoWidget calendarEvents={events} sessionEmail={sessionEmail} onLinkedEventClick={openEditEvent} />
      </div>

      <CalendarDaySheet
        open={daySheetOpen}
        dateKeyStr={selectedDay}
        calendarEvents={events}
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
    </div>
  );
}
