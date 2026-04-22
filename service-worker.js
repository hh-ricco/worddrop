const CACHE = 'worddrop-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/audio.js',
  './js/records.js',
  './js/word-loader.js',
  './js/word-engine.js',
  './js/input.js',
  './js/renderer.js',
  './js/ui.js',
  './js/game.js',
  './words/manifest.json',
  './words/by-category/food.yaml',
  './words/by-category/animals.yaml',
  './words/by-category/transport.yaml',
  './words/by-category/nature.yaml',
  './words/by-category/objects.yaml',
  './words/by-grade/cn-primary-1.yaml',
  './words/by-grade/cn-primary-2.yaml',
  'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  /* External GIF requests (Giphy) — network only, no cache */
  if (e.request.url.includes('giphy.com') || e.request.url.includes('media.giphy')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  /* Cache-first for everything else */
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});
