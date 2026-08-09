/* BSEBC Youth Choir · offline support
   - app shell (page, icons, fonts): serve from cache, refresh in background
   - Supabase reads: try the network, fall back to the last successful response
   - writes are never cached — they need a connection                      */

const SHELL = 'bsebc-youth-shell-v2';
const DATA  = 'bsebc-youth-data-v2';
const ICON_V = '?v=3135';
const SHELL_FILES = ['./', './index.html', './favicon.svg' + ICON_V, './apple-touch-icon.png' + ICON_V,
                     './icon-192.png' + ICON_V, './icon-512.png' + ICON_V, './site.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch writes
  const url = new URL(req.url);

  // the page itself: always try the network first so a new deploy shows up at once
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Supabase reads and Google Fonts: network first, cache as backup
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('gstatic.com')
      || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(DATA).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // same-origin app shell: cache first, then refresh quietly
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(req, copy));
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
