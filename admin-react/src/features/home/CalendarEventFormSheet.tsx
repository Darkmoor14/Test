import { useEffect, useState } from 'react';
import { pad2 } from '../../lib/format';
import { dateKey, describeRecurrence, type CalendarEvent, type RecurrencePattern } from './calendarUtils';
import { RecurrenceSheet } from './RecurrenceSheet';
import type { CalendarEventInput } from './useCalendarEvents';

const REMINDER_OPTIONS = [
  { value: '', label: 'Fără memento' },
  { value: '5', label: 'Cu 5 minute înainte' },
  { value: '15', label: 'Cu 15 minute înainte' },
  { value: '30', label: 'Cu 30 minute înainte' },
  { value: '60', label: 'Cu 1 oră înainte' },
  { value: '1440', label: 'Cu 1 zi înainte' },
];
const END_DURATION_OPTIONS = [
  { value: '30', label: '30 minute' }, { value: '60', label: '1 oră' },
  { value: '90', label: '1,5 ore' }, { value: '120', label: '2 ore' },
];

function buildStartTimeOptions(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) out.push(`${pad2(h)}:${pad2(m)}`);
  }
  return out;
}
const START_TIME_OPTIONS = buildStartTimeOptions();

export function CalendarEventFormSheet({
  open, event, defaultDateKey, allStaffEmails, onClose, onSave, onDelete,
}: {
  open: boolean;
  event: CalendarEvent | null;
  defaultDateKey: string;
  allStaffEmails: string[];
  onClose: () => void;
  onSave: (id: string | null, payload: CalendarEventInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [dateVal, setDateVal] = useState('');
  const [startPrecise, setStartPrecise] = useState(false);
  const [startSelectValue, setStartSelectValue] = useState('09:00');
  const [startPreciseValue, setStartPreciseValue] = useState('');
  const [endPrecise, setEndPrecise] = useState(false);
  const [endDurationValue, setEndDurationValue] = useState('30');
  const [endPreciseValue, setEndPreciseValue] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [reminder, setReminder] = useState('');
  const [attendees, setAttendees] = useState<Set<string>>(new Set());
  const [pendingRecurrence, setPendingRecurrence] = useState<RecurrencePattern | null>(null);
  const [recurrenceSheetOpen, setRecurrenceSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(event ? event.title : '');
    setAllDay(event ? !!event.all_day : false);
    const start = event ? new Date(event.start_time) : null;
    const end = event && event.end_time ? new Date(event.end_time) : null;
    setDateVal(event ? dateKey(start!) : (defaultDateKey || dateKey(new Date())));

    if (start) {
      const hhmm = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
      setStartPreciseValue(hhmm);
      if (start.getMinutes() % 15 === 0) {
        setStartSelectValue(hhmm);
        setStartPrecise(false);
      } else {
        setStartPrecise(true);
      }
    } else {
      const now = new Date();
      let mins = Math.ceil(now.getMinutes() / 15) * 15;
      let hrs = now.getHours();
      if (mins === 60) { mins = 0; hrs = (hrs + 1) % 24; }
      const hhmm = `${pad2(hrs)}:${pad2(mins)}`;
      setStartSelectValue(hhmm);
      setStartPreciseValue(hhmm);
      setStartPrecise(false);
    }

    if (end && start) {
      const hhmm = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
      setEndPreciseValue(hhmm);
      const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
      if ([30, 60, 90, 120].includes(diffMin)) {
        setEndDurationValue(String(diffMin));
        setEndPrecise(false);
      } else {
        setEndPrecise(true);
      }
    } else {
      setEndDurationValue('30');
      setEndPreciseValue('');
      setEndPrecise(false);
    }

    setLocation(event ? (event.location || '') : '');
    setDescription(event ? (event.description || '') : '');
    setReminder(event && event.reminder_minutes_before ? String(event.reminder_minutes_before) : '');
    setAttendees(new Set((event && Array.isArray(event.attendees)) ? event.attendees : []));
    setPendingRecurrence(event && event.recurrence_freq ? {
      recurrence_freq: event.recurrence_freq,
      recurrence_interval: event.recurrence_interval || 1,
      recurrence_days_of_week: event.recurrence_days_of_week || null,
      recurrence_end_type: event.recurrence_end_type || 'never',
      recurrence_end_date: event.recurrence_end_date || null,
      recurrence_count: event.recurrence_count || null,
    } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event, defaultDateKey]);

  if (!open) return null;

  const getStartValue = (): string => (startPrecise ? (startPreciseValue || '00:00') : startSelectValue);
  const getEndValue = (): string | null => {
    if (endPrecise) return endPreciseValue || null;
    if (!dateVal) return null;
    const startVal = getStartValue();
    const endDt = new Date(new Date(`${dateVal}T${startVal}`).getTime() + Number(endDurationValue) * 60000);
    return `${pad2(endDt.getHours())}:${pad2(endDt.getMinutes())}`;
  };

  const toggleAttendee = (email: string) => {
    setAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    if (!dateVal) return;
    const startTimeVal = getStartValue() || '00:00';
    const endTimeVal = getEndValue();
    const startISO = new Date(`${dateVal}T${allDay ? '00:00' : startTimeVal}`).toISOString();
    const endISO = (!allDay && endTimeVal) ? new Date(`${dateVal}T${endTimeVal}`).toISOString() : null;
    const payload: CalendarEventInput = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      start_time: startISO,
      end_time: endISO,
      all_day: allDay,
      reminder_minutes_before: reminder ? Number(reminder) : null,
      recurrence_freq: pendingRecurrence ? pendingRecurrence.recurrence_freq : null,
      recurrence_interval: pendingRecurrence ? pendingRecurrence.recurrence_interval : null,
      recurrence_days_of_week: pendingRecurrence ? pendingRecurrence.recurrence_days_of_week : null,
      recurrence_end_type: pendingRecurrence ? pendingRecurrence.recurrence_end_type : null,
      recurrence_end_date: pendingRecurrence ? pendingRecurrence.recurrence_end_date : null,
      recurrence_count: pendingRecurrence ? pendingRecurrence.recurrence_count : null,
      attendees: attendees.size ? [...attendees] : null,
    };
    setSaving(true);
    const ok = await onSave(event ? event.id : null, payload);
    setSaving(false);
    if (ok) {
      if (typeof window.showToast === 'function') window.showToast('Eveniment salvat.');
      onClose();
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    if (!confirm('Ștergi acest eveniment?')) return;
    const ok = await onDelete(event.id);
    if (ok) onClose();
  };

  return (
    <>
      <div className="mobile-sheet show" aria-hidden="false">
        <div className="mobile-sheet-backdrop" onClick={onClose} />
        <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="calendarEventFormSheetTitle">
          <div className="mobile-sheet-panel-scroll">
            <div className="sheet-handle" />
            <div className="sheet-head">
              <div><h3 id="calendarEventFormSheetTitle">{event ? 'Editează eveniment' : 'Eveniment nou'}</h3></div>
              <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
            </div>
            <div className="ctrl-field">
              <label>Titlu</label>
              <input type="text" placeholder="ex: Întâlnire șantier" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <label className="cef-allday-field">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> Toată ziua
            </label>
            <div className="sheet-grid">
              <div className="ctrl-field">
                <label>Data</label>
                <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
              </div>
              {!allDay && (
                <div className="ctrl-field">
                  <label>Ora început</label>
                  <div className="cef-time-row">
                    <select hidden={startPrecise} value={startSelectValue} onChange={(e) => setStartSelectValue(e.target.value)}>
                      {START_TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button
                      type="button"
                      className={`cef-time-edit-btn${startPrecise ? ' active' : ''}`}
                      title="Editează o oră exactă"
                      aria-label="Editează o oră exactă"
                      onClick={() => {
                        const willBePrecise = !startPrecise;
                        if (willBePrecise && !startPreciseValue) setStartPreciseValue(startSelectValue);
                        setStartPrecise(willBePrecise);
                      }}
                    >
                      🕐
                    </button>
                    <input type="time" className="cef-time-precise" hidden={!startPrecise} value={startPreciseValue} onChange={(e) => setStartPreciseValue(e.target.value)} />
                  </div>
                </div>
              )}
              {!allDay && (
                <div className="ctrl-field">
                  <label>Ora sfârșit</label>
                  <div className="cef-time-row">
                    <select hidden={endPrecise} value={endDurationValue} onChange={(e) => setEndDurationValue(e.target.value)}>
                      {END_DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button
                      type="button"
                      className={`cef-time-edit-btn${endPrecise ? ' active' : ''}`}
                      title="Editează o oră exactă"
                      aria-label="Editează o oră exactă"
                      onClick={() => {
                        const willBePrecise = !endPrecise;
                        if (willBePrecise && !endPreciseValue) setEndPreciseValue(getEndValue() || '');
                        setEndPrecise(willBePrecise);
                      }}
                    >
                      🕐
                    </button>
                    <input type="time" className="cef-time-precise" hidden={!endPrecise} value={endPreciseValue} onChange={(e) => setEndPreciseValue(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
            <div className="ctrl-field">
              <button type="button" className={`btn cef-recur-btn${pendingRecurrence ? ' active' : ''}`} onClick={() => setRecurrenceSheetOpen(true)}>
                {describeRecurrence(pendingRecurrence)}
              </button>
            </div>
            <div className="ctrl-field">
              <label>Memento</label>
              <select value={reminder} onChange={(e) => setReminder(e.target.value)}>
                {REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="ctrl-field">
              <label>Locație (opțional)</label>
              <input type="text" placeholder="ex: Str. Gh. Doja nr. 4" autoComplete="off" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="ctrl-field">
              <label>Descriere (opțional)</label>
              <input type="text" placeholder="Detalii" autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="ctrl-field">
              <label>Alocat cui (opțional)</label>
              <div className="cef-attendees-list">
                {allStaffEmails.length ? allStaffEmails.map((email) => (
                  <label key={email} className="cef-attendee-item">
                    <input type="checkbox" checked={attendees.has(email)} onChange={() => toggleAttendee(email)} /> {email}
                  </label>
                )) : <span className="cef-attendees-empty">Lista de conturi nu s-a încărcat încă.</span>}
              </div>
              <p className="cef-attendees-hint">Lăsat gol → vizibil pentru toată lumea pe Acasă. Bifat → apare doar în „De făcut" al persoanelor alese.</p>
            </div>
            <div className="sheet-actions cef-actions">
              {event && <button type="button" className="btn" onClick={handleDelete}>Șterge</button>}
              <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>Salvează</button>
            </div>
          </div>
        </div>
      </div>
      <RecurrenceSheet
        open={recurrenceSheetOpen}
        onClose={() => setRecurrenceSheetOpen(false)}
        current={pendingRecurrence}
        eventDateKey={dateVal || defaultDateKey}
        onRemove={() => { setPendingRecurrence(null); setRecurrenceSheetOpen(false); }}
        onSave={(pattern) => { setPendingRecurrence(pattern); setRecurrenceSheetOpen(false); }}
      />
    </>
  );
}
