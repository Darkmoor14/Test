// sw.js — service worker for the Insta Grup Admin PWA.
//
// Two jobs only, deliberately kept minimal:
//   1. Satisfy the browser's requirement that an installable PWA have a
//      registered service worker (no meaningful offline caching here —
//      admin.html needs a live connection to Supabase to be useful at
//      all, so there's nothing worth caching for offline use).
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
    data: { url: data.url || 'admin.html' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an already-open admin tab if one
// exists, or opens a new one — rather than always spawning a fresh tab.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : 'admin.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('admin.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
