/* Офлайн-кэш: после первого открытия приложение работает без интернета. */
const CACHE = 'bongo-school-v3';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/audio.js',
  'js/transport.js',
  'js/store.js',
  'js/ui.js',
  'js/wheel.js',
  'js/app.js',
  'js/data/instruments.js',
  'js/data/rhythms.js',
  'js/data/lessons.js',
  'js/pages/start.js',
  'js/pages/lessons.js',
  'js/pages/rhythms.js',
  'js/pages/poly.js',
  'js/pages/metronome.js',
  'js/pages/trainer.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Сначала сеть (чтобы получать обновления), при её отсутствии — кэш
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
