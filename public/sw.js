const CACHE = 'sirona-shell-v2-10';
const SHELL = ['/', '/app.js?v=10', '/assistant-ui.js', '/sync.js', '/validation.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('message', event => {
  if(event.data?.type === 'APPLY_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('sirona-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const shellRequest = SHELL.includes(url.pathname + url.search);
  // Never cache auth, records, reset URLs or third-party content.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || (url.search && !shellRequest)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
  } else if (shellRequest) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
