// Service worker minimo: serve solo a mostrare le notifiche
// e a riportare in primo piano l'app quando si tocca una notifica.

self.addEventListener('install', (event) => {
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
          data = { title: 'Promemoria medicina', body: event.data ? event.data.text() : '' };
    }
    const title = data.title || 'Promemoria medicina';
    const options = {
          body: data.body || '',
          icon: data.icon || 'icon-192.png',
          badge: 'icon-192.png',
          tag: data.tag || 'medicine-reminder',
          renotify: true,
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
          self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
                  for (const client of clientList) {
                            if ('focus' in client) return client.focus();
                  }
                  if (self.clients.openWindow) {
                            return self.clients.openWindow('./index.html');
                  }
          })
        );
});
