// Service Worker for TheBotCompany PWA notifications
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Listen for push events
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'TheBotCompany', body: 'New event' };
  event.waitUntil(
    self.registration.showNotification(data.title || 'TheBotCompany', {
      body: data.body,
      tag: data.tag || 'tbc-notification',
      icon: '/icon-192.png',
    })
  );
});

// Click notification to open/focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
