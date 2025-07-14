const CACHE_NAME = 'ffkst-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/main.js',
  '/keywords.txt',
  '/logo-light.png',
  '/logo-dark.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels',
  'https://unpkg.com/mammoth/mammoth.browser.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    }).catch(() => {
      return new Response('<h1>Offline</h1><p>This resource is not cached.</p>', {
        headers: { 'Content-Type': 'text/html' }
      });
    })
  );
});
