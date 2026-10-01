/* Service worker Motion Playground: офлайн-кэш оболочки приложения.
   Стратегия: статика — stale-while-revalidate; /api и /ws — только сеть. */
const VERSION = 'mp2-v2';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './js/main.js',
  './js/core/bus.js', './js/core/dom.js', './js/core/store.js', './js/core/i18n.js', './js/core/media.js',
  './js/ui/toast.js', './js/ui/commands.js', './js/ui/panels.js', './js/ui/view.js', './js/ui/shortcuts.js', './js/ui/palette.js', './js/ui/peek.js',
  './js/scene/shapes.js', './js/scene/animations.js', './js/scene/objects.js', './js/scene/physics.js', './js/scene/model3d.js',
  './js/scene/webgl.js', './js/scene/effects.js', './js/scene/backgrounds.js', './js/scene/cursorfx.js', './js/scene/preview.js',
  './js/net/transport.js', './js/net/session.js', './js/net/chat.js', './js/net/polls.js', './js/net/cursors.js',
  './js/net/whiteboard.js', './js/net/admin.js', './js/net/qr.js',
  './js/features/audio.js', './js/features/voice.js', './js/features/weather.js', './js/features/widgets.js',
  './js/features/achievements.js', './js/features/easter.js', './js/features/quiz.js', './js/features/pwa.js', './js/features/gestures.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;                 // CDN, Open-Meteo и т.п. — напрямую
  if (url.pathname.includes('/api/') || url.pathname.includes('/ws')) return; // живые данные — только сеть
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
