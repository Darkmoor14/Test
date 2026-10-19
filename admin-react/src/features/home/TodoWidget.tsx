import { useRef } from 'react';
import { pad2 } from '../../lib/format';
import { dateKey, eventsOnDate, type CalendarEvent } from './calendarUtils';
import { useTodoNotes } from './useTodoNotes';

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export function TodoWidget({
  calendarEvents, sessionEmail, onLinkedEventClick,
}: {
  calendarEvents: CalendarEvent[];
  sessionEmail: string | null;
  onLinkedEventClick: (e: CalendarEvent) => void;
}) {
  const { notes, addNote, updateNoteText, deleteNote } = useTodoNotes();
  const newNoteIdRef = useRef<string | null>(null);

  const linkedEvents = eventsOnDate(calendarEvents, dateKey(new Date())).filter(
    (e) => !Array.isArray(e.attendees) || e.attendees.length === 0 || e.attendees.includes(sessionEmail || ''),
  );

  const handleAdd = () => {
    const id = addNote();
    newNoteIdRef.current = id;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(`.home-todo-note[data-note-id="${id}"] textarea`);
      if (el) el.focus();
    });
  };

  const isEmpty = notes.length === 0 && linkedEvents.length === 0;

  return (
    <div className="home-todo-card">
      <div className="home-todo-head">
        <h3>De făcut</h3>
        <button type="button" className="home-todo-add" aria-label="Notiță nouă" onClick={handleAdd}>+ Notiță</button>
      </div>
      <div className="home-todo-list">
        {linkedEvents.map((e) => {
          const timeLabel = e.all_day ? 'Toată ziua' : `${pad2(new Date(e.start_time).getHours())}:${pad2(new Date(e.start_time).getMinutes())}`;
          return (
            <div key={e.id} className="home-todo-note-calendar" onClick={() => onLinkedEventClick(e)}>
              <span className="home-todo-note-calendar-badge"><InfoIcon /> Din calendar</span>
              <p className="home-todo-note-calendar-text">{e.title || 'Eveniment'}</p>
              <span className="home-todo-note-calendar-time">Azi · {timeLabel}</span>
            </div>
          );
        })}
        {notes.map((note, i) => (
          <div key={note.id} className={`home-todo-note color-${(i % 4) + 1}`} data-note-id={note.id}>
            <textarea placeholder="Notează aici…" value={note.text} onChange={(e) => updateNoteText(note.id, e.target.value)} />
            <button type="button" className="home-todo-note-delete" aria-label="Șterge notița" onClick={() => deleteNote(note.id)}>×</button>
          </div>
        ))}
      </div>
      {isEmpty && <p className="home-todo-empty">Nicio notiță încă — apasă „+ Notiță” ca să adaugi prima.</p>}
    </div>
  );
}
