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
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(targetUrl);
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});
