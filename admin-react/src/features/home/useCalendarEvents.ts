import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '../../lib/supabaseContext';
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

  const deleteEvent = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('calendar_events').delete().eq('id', id);
    if (error) {
      console.error('Ștergerea a eșuat:', error);
      alert('Ștergerea a eșuat.');
      return false;
    }
    await reload();
    return true;
  }, [supabase, reload]);

  return { events, loading, reload, saveEvent, deleteEvent };
}
