// Lux Learning — Custom SW additions: push notifications + notification click
// @ducanh2912/next-pwa appends this file to the Workbox-generated sw.js at build time.
// Must be plain JS (not TS) — next-pwa does not transpile this file.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch (_) {
    data = { title: 'Lux Learning', body: event.data.text(), url: '/' };
  }

  const title = data.title ?? 'Lux Learning';
  const options = {
    body: data.body ?? '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    tag: data.tag ?? 'lux-push',
    renotify: true,
    data: { url: data.url ?? '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        // Fix #9: find window already at target URL and focus it, don't blindly navigate
        const existing = windowClients.find((c) => c.url.endsWith(targetUrl));
        if (existing) {
          return existing.focus();
        }
        // Focus any open window and navigate it
        const any = windowClients.find((c) => 'focus' in c);
        if (any) {
          await any.focus();
          // navigate() may not exist in all browsers — use openWindow as fallback
          if ('navigate' in any) {
            return any.navigate(targetUrl);
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
