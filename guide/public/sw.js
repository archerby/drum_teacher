/* Офлайн-оболочка: приложение и тексты кэшируются, карта и API — только из сети. */
const CACHE = 'warsaw-guide-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/route.js', 'js/moods.js', 'js/i18n.js', 'js/map.js', 'data/pois.js',
  'i18n/ru.js', 'i18n/en.js', 'i18n/pl.js', 'i18n/uk.js', 'i18n/be.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/qrcode.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/upupa_mascot_sm.png', 'icons/upupa_mascot_md.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // Сначала сеть (чтобы обновления приходили сразу), при её отсутствии — кэш.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
