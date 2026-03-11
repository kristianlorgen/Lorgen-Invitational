const VERSION = 'v1';
const STATIC_CACHE = `lorgen-static-${VERSION}`;
const PAGE_CACHE = `lorgen-pages-${VERSION}`;
const API_CACHE = `lorgen-api-${VERSION}`;

const SHELL_FILES = [
  '/',
  '/offline.html',
  '/css/style.css',
  '/images/logo.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => ![STATIC_CACHE, PAGE_CACHE, API_CACHE].includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isLiveApi(pathname) {
  return pathname.startsWith('/api/scoreboard') || pathname.startsWith('/api/team/scorecard');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (isLiveApi(url.pathname)) {
      event.respondWith((async () => {
        try {
          return await fetch(request);
        } catch (_) {
          return new Response(JSON.stringify({ error: 'offline', message: 'Ingen nettilkobling akkurat nå' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      })());
      return;
    }

    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await cache.match(request);
        return cached || new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    })());
    return;
  }

  const isNavigation = request.mode === 'navigate';

  if (isNavigation) {
    event.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch (_) {
        return (await cache.match(request)) || (await caches.match('/offline.html'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const staticCache = await caches.open(STATIC_CACHE);
    const cached = await staticCache.match(request);
    if (cached) return cached;

    try {
      const fresh = await fetch(request);
      if (fresh.ok && /\.(css|js|png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)) {
        staticCache.put(request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      return cached || Response.error();
    }
  })());
});


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
