self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch (_) {
    payload = { body: event.data.text() };
  }

  const title = payload.title || 'Lorgen Invitational';
  const options = {
    body: payload.body || 'Du har en ny oppdatering.',
    icon: '/images/logo.png',
    badge: '/images/logo.png',
    tag: payload.tag || 'lorgen-update',
    renotify: true,
    data: { url: payload.url || '/enter-score' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/enter-score';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    const targetPath = (() => {
      try {
        return new URL(targetUrl, self.location.origin).pathname;
      } catch (_) {
        return '/enter-score';
      }
    })();

    for (const client of windows) {
      try {
        if (new URL(client.url).pathname === targetPath) {
          if ('focus' in client) await client.focus();
          return;
        }
      } catch (_) {}
    }

    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});
