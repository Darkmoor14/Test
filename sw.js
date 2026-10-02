// sw.js — service worker for the Insta Grup Admin PWA.
//
// Two jobs only, deliberately kept minimal:
//   1. Satisfy the browser's requirement that an installable PWA have a
//      registered service worker (no meaningful offline caching here —
//      the admin panel needs a live connection to Supabase to be useful
//      at all, so there's nothing worth caching for offline use).
//   2. Receive Web Push messages sent by the "send-push" Supabase Edge
//      Function and show them as real OS-level notifications, even
//      when the admin panel isn't open in a tab.

const CACHE_NAME = 'insta-grup-admin-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Insta Grup', body: event.data ? event.data.text() : 'Notificare nouă' };
  }

  const title = data.title || 'Sesizare nouă';
  const options = {
    body: data.body || 'A fost înregistrată o sesizare nouă pe site.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: data.url || 'admin-3.html' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an already-open admin tab if one
// exists, or opens a new one — rather than always spawning a fresh tab.
//
// Important detail: focus() alone does NOT navigate an already-open
// tab to the new ticket — it just brings that tab to the front,
// whatever it currently happens to be showing. So if the admin panel
// is already open (on a different ticket, or a different tab
// entirely) and a new notification comes in, tapping it would
// previously just refocus the same old view. Fixed by also posting a
// message the page listens for, telling it which ticket to jump to
// without needing a full reload.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : 'admin-3.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Match admin.html, admin-2.html or admin-3.html — all three have
      // shared this one service worker across the app's successive
      // rewrites. This used to only check for 'admin.html', which is
      // NOT a substring of 'admin-2.html' or 'admin-3.html', so those
      // users' already-open tab was never found here — every
      // notification tap fell through to openWindow() below and
      // spawned a brand new tab instead of updating the existing one,
      // which is why tapping a notification often looked like it did
      // nothing until manually switching tabs.
      const adminClient = clientList.find(client => /\/admin(-2|-3)?\.html(\?|#|$)/.test(client.url));
      if (adminClient && 'focus' in adminClient) {
        adminClient.postMessage({ type: 'go-to-ticket-url', url: targetUrl });
        return adminClient.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
