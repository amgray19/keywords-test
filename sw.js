const CACHE_NAME = 'ffkst-v2';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/main.js',
  '/style.css',
  '/keywords.txt',
  '/keywords.json',
  '/lib/chart.js',
  '/lib/chartjs-plugin-datalabels.js',
  '/lib/mammoth.browser.min.js'
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
