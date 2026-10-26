import { useEffect, useState } from 'react';
import { pad2 } from '../../lib/format';
import { dateKey, describeRecurrence, isoWeekday, type CalendarEvent, type RecurrenceFreq, type RecurrencePattern } from './calendarUtils';
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
const TRAVEL_TIME_OPTIONS = [
  { value: '', label: 'Fără' },
  { value: '5', label: '5 minute' },
  { value: '15', label: '15 minute' },
  { value: '30', label: '30 minute' },
  { value: '45', label: '45 minute' },
  { value: '60', label: '1 oră' },
  { value: '90', label: '1,5 ore' },
  { value: '120', label: '2 ore' },
];

type RepeatPreset = 'none' | RecurrenceFreq | 'custom';
const REPEAT_OPTIONS: { value: RepeatPreset; label: string }[] = [
  { value: 'none', label: 'Niciodată' },
  { value: 'daily', label: 'Zilnic' },
  { value: 'weekly', label: 'Săptămânal' },
  { value: 'monthly', label: 'Lunar' },
  { value: 'yearly', label: 'Anual' },
  { value: 'custom', label: 'Personalizat…' },
];

function buildStartTimeOptions(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) out.push(`${pad2(h)}:${pad2(m)}`);
  }
  return out;
}
const TIME_OPTIONS = buildStartTimeOptions();

// A pattern only round-trips through the dropdown if it's exactly what
// picking that preset would produce (interval 1, no end date/count, and
// for weekly, only the event's own start weekday) -- anything else (a
// custom interval, several weekdays, an end date/count) falls back to
// 'custom' so RecurrenceSheet stays the source of truth for it.
function presetFromPattern(r: RecurrencePattern | null, startDateVal: string): RepeatPreset {
  if (!r) return 'none';
  if (r.recurrence_interval !== 1 || r.recurrence_end_type !== 'never') return 'custom';
  if (r.recurrence_freq === 'weekly') {
    const [y, m, d] = startDateVal.split('-').map(Number);
    const startWd = isoWeekday(new Date(y, m - 1, d));
    if (!r.recurrence_days_of_week || r.recurrence_days_of_week.length !== 1 || r.recurrence_days_of_week[0] !== startWd) return 'custom';
  }
  return r.recurrence_freq;
}
function patternFromPreset(preset: Exclude<RepeatPreset, 'custom'>, startDateVal: string): RecurrencePattern | null {
  if (preset === 'none') return null;
  const [y, m, d] = startDateVal.split('-').map(Number);
  const startWd = isoWeekday(new Date(y, m - 1, d));
  return {
    recurrence_freq: preset,
    recurrence_interval: 1,
    recurrence_days_of_week: preset === 'weekly' ? [startWd] : null,
    recurrence_end_type: 'never',
    recurrence_end_date: null,
    recurrence_count: null,
  };
}

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
  const [startDateVal, setStartDateVal] = useState('');
  const [startPrecise, setStartPrecise] = useState(false);
  const [startSelectValue, setStartSelectValue] = useState('09:00');
  const [startPreciseValue, setStartPreciseValue] = useState('');
  const [endDateVal, setEndDateVal] = useState('');
  const [endPrecise, setEndPrecise] = useState(false);
  const [endSelectValue, setEndSelectValue] = useState('09:30');
  const [endPreciseValue, setEndPreciseValue] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [reminder, setReminder] = useState('');
  const [travelTime, setTravelTime] = useState('');
  const [attendees, setAttendees] = useState<Set<string>>(new Set());
  const [attendeeInput, setAttendeeInput] = useState('');
  const [pendingRecurrence, setPendingRecurrence] = useState<RecurrencePattern | null>(null);
  const [recurrenceSheetOpen, setRecurrenceSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(event ? event.title : '');
    setAllDay(event ? !!event.all_day : false);
    const start = event ? new Date(event.start_time) : null;
    const end = event && event.end_time ? new Date(event.end_time) : null;
    const initialStartDate = event ? dateKey(start!) : (defaultDateKey || dateKey(new Date()));
    setStartDateVal(initialStartDate);

    let initialStartHHMM: string;
    if (start) {
      initialStartHHMM = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
      setStartPreciseValue(initialStartHHMM);
      if (start.getMinutes() % 15 === 0) {
        setStartSelectValue(initialStartHHMM);
        setStartPrecise(false);
      } else {
        setStartPrecise(true);
      }
    } else {
      const now = new Date();
      let mins = Math.ceil(now.getMinutes() / 15) * 15;
      let hrs = now.getHours();
      if (mins === 60) { mins = 0; hrs = (hrs + 1) % 24; }
      initialStartHHMM = `${pad2(hrs)}:${pad2(mins)}`;
      setStartSelectValue(initialStartHHMM);
      setStartPreciseValue(initialStartHHMM);
      setStartPrecise(false);
    }

    if (end) {
      setEndDateVal(dateKey(end));
      const hhmm = `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
      setEndPreciseValue(hhmm);
      if (end.getMinutes() % 15 === 0) {
        setEndSelectValue(hhmm);
        setEndPrecise(false);
      } else {
        setEndPrecise(true);
      }
    } else {
      setEndDateVal(initialStartDate);
      const endDt = new Date(`${initialStartDate}T${initialStartHHMM}`);
      endDt.setMinutes(endDt.getMinutes() + 30);
      const hhmm = `${pad2(endDt.getHours())}:${pad2(endDt.getMinutes())}`;
      setEndSelectValue(hhmm);
      setEndPreciseValue(hhmm);
      setEndPrecise(false);
    }

    setLocation(event ? (event.location || '') : '');
    setDescription(event ? (event.description || '') : '');
    setUrl(event ? (event.url || '') : '');
    setReminder(event && event.reminder_minutes_before ? String(event.reminder_minutes_before) : '');
    setTravelTime(event && event.travel_time_minutes ? String(event.travel_time_minutes) : '');
    setAttendees(new Set((event && Array.isArray(event.attendees)) ? event.attendees : []));
    setAttendeeInput('');
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
  const getEndValue = (): string => (endPrecise ? (endPreciseValue || '00:00') : endSelectValue);

  // Keeps the event's duration constant when the start time moves, same
  // as dragging an event's start in Apple Calendar -- without this, a
  // changed start time with a fixed end could silently flip the event
  // negative-duration.
  const shiftEndWithNewStart = (newStartTimeVal: string) => {
    if (allDay) return;
    const oldStart = new Date(`${startDateVal}T${getStartValue()}`);
    const oldEnd = new Date(`${endDateVal}T${getEndValue()}`);
    const durationMs = Math.max(0, oldEnd.getTime() - oldStart.getTime());
    const newStart = new Date(`${startDateVal}T${newStartTimeVal}`);
    const newEnd = new Date(newStart.getTime() + durationMs);
    setEndDateVal(dateKey(newEnd));
    const hhmm = `${pad2(newEnd.getHours())}:${pad2(newEnd.getMinutes())}`;
    setEndSelectValue(hhmm);
    setEndPreciseValue(hhmm);
  };

  const onStartDateChange = (newDate: string) => {
    setEndDateVal((prevEnd) => (prevEnd === startDateVal ? newDate : prevEnd));
    setStartDateVal(newDate);
  };

  const addAttendee = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setAttendees((prev) => new Set(prev).add(v));
    setAttendeeInput('');
  };
  const removeAttendee = (value: string) => {
    setAttendees((prev) => {
      const next = new Set(prev);
      next.delete(value);
      return next;
    });
  };
  const isEmailShaped = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  // Staff already get the event in their own Acasă/"De făcut" feed once
  // saved -- this is only for someone with no account here at all, so
  // it's offered only for an email-shaped entry that isn't one of them.
  // mailto: accepts comma-separated recipients, so one emails and the
  // "share with all" button are the same builder with a different list.
  const buildInviteMailto = (emails: string[]): string => {
    const subject = `Invitație: ${title.trim() || 'eveniment'}`;
    const bodyLines = [
      `Eveniment: ${title.trim() || '(fără titlu)'}`,
      `Data: ${startDateVal}${!allDay ? ` ${getStartValue()}` : ' (toată ziua)'}`,
      location.trim() ? `Locație: ${location.trim()}` : null,
    ].filter(Boolean) as string[];
    return `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
  };
  const attendeeSuggestions = attendeeInput.trim()
    ? allStaffEmails.filter((e) => e.toLowerCase().includes(attendeeInput.trim().toLowerCase()) && !attendees.has(e)).slice(0, 6)
    : [];
  const externalInvitees = [...attendees].filter((a) => isEmailShaped(a) && !allStaffEmails.includes(a));

  const repeatPreset = presetFromPattern(pendingRecurrence, startDateVal);
  const onRepeatChange = (val: RepeatPreset) => {
    if (val === 'custom') { setRecurrenceSheetOpen(true); return; }
    setPendingRecurrence(patternFromPreset(val, startDateVal));
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    if (!startDateVal || !endDateVal) return;
    const startTimeVal = allDay ? '00:00' : getStartValue();
    const endTimeVal = allDay ? '23:59' : getEndValue();
    const startDt = new Date(`${startDateVal}T${startTimeVal}`);
    const endDt = new Date(`${endDateVal}T${endTimeVal}`);
    if (endDt < startDt) {
      alert('Data de final nu poate fi înainte de data de început.');
      return;
    }
    const payload: CalendarEventInput = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      start_time: startDt.toISOString(),
      end_time: endDt.toISOString(),
      all_day: allDay,
      reminder_minutes_before: reminder ? Number(reminder) : null,
      recurrence_freq: pendingRecurrence ? pendingRecurrence.recurrence_freq : null,
      recurrence_interval: pendingRecurrence ? pendingRecurrence.recurrence_interval : null,
      recurrence_days_of_week: pendingRecurrence ? pendingRecurrence.recurrence_days_of_week : null,
      recurrence_end_type: pendingRecurrence ? pendingRecurrence.recurrence_end_type : null,
      recurrence_end_date: pendingRecurrence ? pendingRecurrence.recurrence_end_date : null,
      recurrence_count: pendingRecurrence ? pendingRecurrence.recurrence_count : null,
      attendees: attendees.size ? [...attendees] : null,
      travel_time_minutes: travelTime ? Number(travelTime) : null,
      url: url.trim() || null,
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
      <div id="calendarEventFormSheet" className="mobile-sheet show" aria-hidden="false">
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

            <div className="ctrl-field">
              <label>Începe</label>
              <div className="cef-date-time-row">
                <input type="date" value={startDateVal} onChange={(e) => onStartDateChange(e.target.value)} />
                {!allDay && (
                  <div className="cef-time-row">
                    <select hidden={startPrecise} value={startSelectValue} onChange={(e) => { setStartSelectValue(e.target.value); shiftEndWithNewStart(e.target.value); }}>
                      {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
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
                    <input type="time" className="cef-time-precise" hidden={!startPrecise} value={startPreciseValue} onChange={(e) => { setStartPreciseValue(e.target.value); shiftEndWithNewStart(e.target.value); }} />
                  </div>
                )}
              </div>
            </div>

            <div className="ctrl-field">
              <label>Se termină</label>
              <div className="cef-date-time-row">
                <input type="date" value={endDateVal} min={startDateVal} onChange={(e) => setEndDateVal(e.target.value)} />
                {!allDay && (
                  <div className="cef-time-row">
                    <select hidden={endPrecise} value={endSelectValue} onChange={(e) => setEndSelectValue(e.target.value)}>
                      {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button
                      type="button"
                      className={`cef-time-edit-btn${endPrecise ? ' active' : ''}`}
                      title="Editează o oră exactă"
                      aria-label="Editează o oră exactă"
                      onClick={() => {
                        const willBePrecise = !endPrecise;
                        if (willBePrecise && !endPreciseValue) setEndPreciseValue(endSelectValue);
                        setEndPrecise(willBePrecise);
                      }}
                    >
                      🕐
                    </button>
                    <input type="time" className="cef-time-precise" hidden={!endPrecise} value={endPreciseValue} onChange={(e) => setEndPreciseValue(e.target.value)} />
                  </div>
                )}
              </div>
            </div>

            <label className="cef-allday-field">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> Toată ziua
            </label>

            <div className="ctrl-field">
              <label>Repetare</label>
              <div className="cef-time-row">
                <select value={repeatPreset} onChange={(e) => onRepeatChange(e.target.value as RepeatPreset)}>
                  {REPEAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {repeatPreset === 'custom' && (
                  <button type="button" className="btn" onClick={() => setRecurrenceSheetOpen(true)}>Modifică…</button>
                )}
              </div>
              {repeatPreset === 'custom' && pendingRecurrence && (
                <p className="cef-recur-custom-desc">{describeRecurrence(pendingRecurrence)}</p>
              )}
            </div>

            <div className="ctrl-field">
              <label>Locație (opțional)</label>
              <input type="text" placeholder="ex: Str. Gh. Doja nr. 4" autoComplete="off" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>

            <div className="ctrl-field">
              <label>Invitați (opțional)</label>
              <div className="cef-invitee-input-row">
                <input
                  type="text" placeholder="Nume sau email" autoComplete="off" value={attendeeInput}
                  onChange={(e) => setAttendeeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttendee(attendeeInput); } }}
                />
                <button type="button" className="btn" onClick={() => addAttendee(attendeeInput)}>+ Adaugă</button>
              </div>
              {attendeeSuggestions.length > 0 && (
                <div className="cef-invitee-suggestions">
                  {attendeeSuggestions.map((email) => (
                    <button type="button" key={email} className="cef-invitee-suggestion" onClick={() => addAttendee(email)}>
                      {email}
                    </button>
                  ))}
                </div>
              )}
              {externalInvitees.length > 1 && (
                <a
                  className="cef-attendee-share-all" href={buildInviteMailto(externalInvitees)}
                  title={`Trimite invitație tuturor (${externalInvitees.length})`}
                  aria-label={`Trimite invitație tuturor (${externalInvitees.length})`}
                  onClick={(e) => e.stopPropagation()}
                >✉<span>{externalInvitees.length}</span></a>
              )}
              {attendees.size > 0 && (
                <div className="cef-attendee-tags">
                  {[...attendees].map((a) => {
                    const canInvite = isEmailShaped(a) && !allStaffEmails.includes(a);
                    return (
                      <span key={a} className="cef-attendee-tag">
                        {a}
                        {canInvite && (
                          <a
                            className="cef-attendee-share" href={buildInviteMailto([a])}
                            title={`Trimite invitație prin email către ${a}`} aria-label={`Trimite invitație prin email către ${a}`}
                            onClick={(e) => e.stopPropagation()}
                          >✉</a>
                        )}
                        <button type="button" aria-label={`Elimină ${a}`} onClick={() => removeAttendee(a)}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <p className="cef-attendees-hint">Fără invitați → eveniment privat, vizibil doar pentru tine. Cu invitați adăugați → vizibil pentru tine și pentru persoanele adăugate (apare în „De făcut" al fiecăreia).</p>
            </div>

            <div className="ctrl-field">
              <label>Memento</label>
              <select value={reminder} onChange={(e) => setReminder(e.target.value)}>
                {REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="ctrl-field">
              <label>Timp de deplasare</label>
              <select value={travelTime} onChange={(e) => setTravelTime(e.target.value)}>
                {TRAVEL_TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="ctrl-field">
              <label>Note (opțional)</label>
              <input type="text" placeholder="Detalii" autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="ctrl-field">
              <label>Link (opțional)</label>
              <input type="url" placeholder="https://…" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />
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
        eventDateKey={startDateVal || defaultDateKey}
        onRemove={() => { setPendingRecurrence(null); setRecurrenceSheetOpen(false); }}
        onSave={(pattern) => { setPendingRecurrence(pattern); setRecurrenceSheetOpen(false); }}
      />
    </>
  );
}
