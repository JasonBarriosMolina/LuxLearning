// Custom service worker additions — push notifications + notification click
// This file is compiled and appended to the Workbox-generated sw.js by next-pwa.

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Lux Learning', body: event.data.text(), url: '/' };
  }

  const title = data.title ?? 'Lux Learning';
  const options: NotificationOptions = {
    body: data.body ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag ?? 'lux-push',
    renotify: true,
    data: { url: data.url ?? '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url: string = (event.notification.data?.url as string) ?? '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if ('focus' in client) {
            (client as WindowClient).focus();
            (client as WindowClient).navigate(url);
            return;
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
