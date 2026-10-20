import { useEffect, useState } from 'react';
import { dateKey, isoWeekday, RECUR_INTERVAL_UNITS, type RecurrenceEndType, type RecurrenceFreq, type RecurrencePattern } from './calendarUtils';

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Luni' }, { value: 2, label: 'Marți' }, { value: 3, label: 'Miercuri' },
  { value: 4, label: 'Joi' }, { value: 5, label: 'Vineri' }, { value: 6, label: 'Sâmbătă' }, { value: 7, label: 'Duminică' },
];

export function RecurrenceSheet({
  open, onClose, current, eventDateKey, onRemove, onSave,
}: {
  open: boolean;
  onClose: () => void;
  current: RecurrencePattern | null;
  eventDateKey: string;
  onRemove: () => void;
  onSave: (pattern: RecurrencePattern) => void;
}) {
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly');
  const [interval, setInterval_] = useState(1);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [endType, setEndType] = useState<RecurrenceEndType>('date');
  const [endDate, setEndDate] = useState('');
  const [count, setCount] = useState(10);

  useEffect(() => {
    if (!open) return;
    const r = current;
    const f = r?.recurrence_freq || 'weekly';
    setFreq(f);
    setInterval_(r?.recurrence_interval || 1);
    if (r?.recurrence_days_of_week && r.recurrence_days_of_week.length) {
      setWeekdays(new Set(r.recurrence_days_of_week));
    } else if (!r) {
      const [y, m, d] = eventDateKey.split('-').map(Number);
      setWeekdays(new Set([isoWeekday(new Date(y, m - 1, d))]));
    } else {
      setWeekdays(new Set());
    }
    setEndType(r?.recurrence_end_type && r.recurrence_end_type !== 'never' ? r.recurrence_end_type : (r ? r.recurrence_end_type : 'date'));
    setEndDate(r?.recurrence_end_date || (() => {
      const dt = new Date(eventDateKey + 'T00:00:00');
      dt.setMonth(dt.getMonth() + 6);
      return dateKey(dt);
    })());
    setCount(r?.recurrence_count || 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const intervalUnit = RECUR_INTERVAL_UNITS[freq](interval);

  const toggleWeekday = (value: number) => {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const handleOk = () => {
    const daysOfWeek = freq === 'weekly' ? [...weekdays] : null;
    if (freq === 'weekly' && (!daysOfWeek || daysOfWeek.length === 0)) {
      alert('Alege cel puțin o zi a săptămânii.');
      return;
    }
    onSave({
      recurrence_freq: freq,
      recurrence_interval: Math.max(1, interval || 1),
      recurrence_days_of_week: daysOfWeek,
      recurrence_end_type: endType,
      recurrence_end_date: endType === 'date' ? (endDate || null) : null,
      recurrence_count: endType === 'count' ? (Number(count) || 1) : null,
    });
  };

  return (
    <div id="recurrenceSheet" className="mobile-sheet show" aria-hidden="false">
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="recurrenceSheetTitle">
        <div className="mobile-sheet-panel-scroll">
          <div className="sheet-handle" />
          <div className="sheet-head">
            <div><h3 id="recurrenceSheetTitle">Recurență eveniment</h3></div>
            <button type="button" className="sheet-close" aria-label="Închide" onClick={onClose}>×</button>
          </div>
          <div className="recur-section">
            <label className="recur-section-label">Model de recurență</label>
            <div className="recur-freq-row">
              {(['daily', 'weekly', 'monthly', 'yearly'] as RecurrenceFreq[]).map((f) => (
                <label key={f} className="recur-radio">
                  <input type="radio" name="recur-freq" checked={freq === f} onChange={() => setFreq(f)} />
                  {f === 'daily' ? 'Zilnic' : f === 'weekly' ? 'Săptămânal' : f === 'monthly' ? 'Lunar' : 'Anual'}
                </label>
              ))}
            </div>
            <div className="recur-interval-row">
              <span>Repetă la fiecare</span>
              <input type="number" min={1} value={interval} onChange={(e) => setInterval_(Number(e.target.value) || 1)} />
              <span>{intervalUnit}</span>
            </div>
            {freq === 'weekly' && (
              <div className="recur-weekdays-row">
                {WEEKDAYS.map((wd) => (
                  <label key={wd.value} className="recur-checkbox">
                    <input type="checkbox" checked={weekdays.has(wd.value)} onChange={() => toggleWeekday(wd.value)} />
                    {wd.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="recur-section">
            <label className="recur-section-label">Interval de recurență</label>
            <div className="ctrl-field">
              <label>Start</label>
              <input type="date" value={eventDateKey} disabled readOnly />
            </div>
            <label className="recur-radio-row">
              <input type="radio" name="recur-end" checked={endType === 'date'} onChange={() => setEndType('date')} /> Se termină la{' '}
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <label className="recur-radio-row">
              <input type="radio" name="recur-end" checked={endType === 'count'} onChange={() => setEndType('count')} /> Se termină după{' '}
              <input type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} /> apariții
            </label>
            <label className="recur-radio-row">
              <input type="radio" name="recur-end" checked={endType === 'never'} onChange={() => setEndType('never')} /> Fără dată de final
            </label>
          </div>
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={onRemove}>Elimină recurența</button>
            <button type="button" className="btn" onClick={onClose}>Anulează</button>
            <button type="button" className="btn btn-primary" onClick={handleOk}>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
