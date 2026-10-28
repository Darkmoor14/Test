import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
import { useRealtimeReload } from '../../lib/useRealtimeReload';
import type { CalendarEvent } from './calendarUtils';

export interface CalendarEventInput {
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  reminder_minutes_before: number | null;
  recurrence_freq: CalendarEvent['recurrence_freq'];
  recurrence_interval: number | null;
  recurrence_days_of_week: number[] | null;
  recurrence_end_type: CalendarEvent['recurrence_end_type'];
  recurrence_end_date: string | null;
  recurrence_count: number | null;
  attendees: string[] | null;
  travel_time_minutes: number | null;
  url: string | null;
}

export function useCalendarEvents(sessionEmail: string | null) {
  const supabase = useSupabase();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*')
      .order('start_time', { ascending: true });
    if (error) {
      console.error('loadCalendarEvents failed:', error);
      setLoading(false);
      return;
    }
    setEvents((data as CalendarEvent[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Lets a change made on the CalDAV side (a phone/Mac calendar
  // account writing straight to this table) or by another staff
  // member show up here without reopening Acasă -- safe from clobbering
  // an open CalendarEventFormSheet, since that sheet is handed a
  // snapshot captured when it was opened (HomePage's formEvent), not a
  // live reference into this array.
  useRealtimeReload(supabase, 'calendar_events', reload);

  const saveEvent = useCallback(async (id: string | null, payload: CalendarEventInput): Promise<boolean> => {
    try {
      if (id) {
        const { error } = await supabase.from('calendar_events').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('calendar_events').insert({ ...payload, created_by: sessionEmail || null, reminder_sent_at: null });
        if (error) throw error;
      }
      await reload();
      return true;
    } catch (err) {
      console.error('Salvarea evenimentului a eșuat:', err);
      alert('Salvarea evenimentului a eșuat. Încearcă din nou.');
      return false;
    }
  }, [supabase, sessionEmail, reload]);

  // staffRecipients are the deleted event's attendees who have an account
  // here -- they get a push warning them it's gone from their "De făcut"
  // feed. External (non-staff) invitees have no account to push to; the
  // form offers them a cancellation email + CANCEL .ics separately.
  const deleteEvent = useCallback(async (event: CalendarEvent, staffRecipients: string[]): Promise<boolean> => {
    const { error } = await supabase.from('calendar_events').delete().eq('id', event.id);
    if (error) {
      console.error('Ștergerea a eșuat:', error);
      alert('Ștergerea a eșuat.');
      return false;
    }
    await reload();
    if (staffRecipients.length > 0) {
      try {
        const { error: pushError } = await supabase.functions.invoke('send-push', {
          body: {
            title: 'Eveniment anulat',
            body: `"${event.title}" a fost șters din calendar.`,
            url: 'admin-3.html',
            recipients: staffRecipients,
          },
        });
        if (pushError) console.error('send-push failed:', pushError);
      } catch (err) {
        console.error('send-push call failed:', err);
      }
    }
    return true;
  }, [supabase, reload]);

  return { events, loading, reload, saveEvent, deleteEvent };
}
