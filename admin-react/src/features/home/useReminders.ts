import { useEffect, useRef } from 'react';
import type { CalendarEvent } from './calendarUtils';
import { pad2 } from '../../lib/format';

declare global {
  interface Window {
    showToast?: (message: string) => void;
  }
}

const CAL_REMINDER_NOTIFIED_KEY = 'insta-grup-vlas-cal-reminders-notified-v1';

function loadNotifiedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CAL_REMINDER_NOTIFIED_KEY) || '[]');
  } catch {
    return [];
  }
}

function showToast(message: string) {
  if (typeof window.showToast === 'function') {
    window.showToast(message);
  }
}

// Foreground-only reminder engine -- checks once a minute for events whose
// reminder time just arrived, independent of (and never conflicting with)
// any server-side cron dispatch keyed on reminder_sent_at. Each event only
// ever fires once per browser (tracked here via localStorage).
export function useReminders(calendarEvents: CalendarEvent[]) {
  const notifiedIdsRef = useRef<string[]>(loadNotifiedIds());
  const lastCheckedMinuteRef = useRef<string | null>(null);
  const eventsRef = useRef(calendarEvents);
  eventsRef.current = calendarEvents;

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
      if (minuteKey === lastCheckedMinuteRef.current) return;
      lastCheckedMinuteRef.current = minuteKey;
      eventsRef.current.forEach((e) => {
        if (!e.reminder_minutes_before || notifiedIdsRef.current.includes(e.id)) return;
        const start = new Date(e.start_time);
        const dueAt = new Date(start.getTime() - e.reminder_minutes_before * 60000);
        if (now >= dueAt && now < start) {
          notifiedIdsRef.current = [...notifiedIdsRef.current, e.id];
          try { localStorage.setItem(CAL_REMINDER_NOTIFIED_KEY, JSON.stringify(notifiedIdsRef.current)); } catch { /* ignore */ }
          const body = e.location || `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
          const notifTitle = `Memento: ${e.title}`;
          showToast(notifTitle);
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then((reg) => {
              if (reg && reg.showNotification) {
                reg.showNotification(notifTitle, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }).catch(() => {});
              } else if ('Notification' in window && Notification.permission === 'granted') {
                try { new Notification(notifTitle, { body }); } catch { /* ignore */ }
              }
            });
          } else if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(notifTitle, { body }); } catch { /* ignore */ }
          }
        }
      });
    };
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, []);
}
