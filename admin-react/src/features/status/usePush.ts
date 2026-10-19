import { useCallback } from 'react';
import { useSupabase } from '../../lib/supabaseContext';

// Same VAPID key already committed in admin-core.js -- public by design.
const VAPID_PUBLIC_KEY = 'BBQABSiPkAUnsoP8vP5NIFs6P0ZpkoUiHf7zl-_f5bDkSGVbL4gKDCtSPv0Y7sFhhWy5dbQPOqRxKdgx2TC0QZY';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Ported from admin-core.js's subscribeToPush -- registers the SAME sw.js
// the rest of the app already uses for ticket push notifications.
// `landingPage` controls which page a cold-start notification tap opens
// (send-push reads this column) -- pass 'admin-3.html' once mounted there,
// defaults to 'admin-react' for the standalone pilot.
export function useSubscribeToPush(sessionEmail: string | null, landingPage: string = 'admin-react') {
  const supabase = useSupabase();
  return useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;
    try {
      // Idempotent -- if admin-core.js already registered this same
      // scope (the mounted case), this just returns that registration.
      const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
      if (!reg) return;

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const subJson = sub.toJSON();
      await supabase.from('push_subscriptions').upsert(
        {
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
          landing_page: landingPage,
          user_email: sessionEmail,
        },
        { onConflict: 'endpoint' },
      );
    } catch (err) {
      console.error('Push subscription failed:', err);
    }
  }, [sessionEmail, landingPage, supabase]);
}
