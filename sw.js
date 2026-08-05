// NOTE: nothing registers this worker. No page has ever called
// navigator.serviceWorker.register(), so the tool has never actually cached
// anything or worked offline, despite the feature list once claiming it did.
// The file is kept correct so that registering it is a one-line change.
//
// Paths are relative to the worker's scope. They used to be absolute ('/'),
// which resolves to the domain root — wrong on a project page served from a
// subdirectory, so cache.addAll() would 404 and the install would reject.
const CACHE_NAME = 'ffkst-v4';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './main.js',
  './theme-init.js',
  './docx-export.js',
  './style.css',
  './keywords.txt',
  './keywords.json',
  './terms-to-use.json',
  './lib/echarts.min.js',
  './lib/mammoth.browser.min.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js'
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
