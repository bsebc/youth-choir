/* BSEBC Youth Choir · offline support
   - app shell (the page, the Supabase library, icons): served from the cache,
     refreshed in the background
   - Supabase reads: network first, the last good copy when offline
   - never stored: writes, sign-in, signed sheet links (a new token every time;
     the page keeps its own offline copies of sheets), part recordings (streamed
     in ranges), photos, the director-only usage log, and any response that
     did not come back OK                                                    */

const SHELL = 'bsebc-youth-shell-v3';
const DATA  = 'bsebc-youth-data-v3';
const SHEETS = 'bsebc-youth-sheets-v1';   // sheet PDFs stored by the page for offline use
const ICON_V = '?v=3200';
const SHELL_FILES = ['./', './index.html', './vendor/supabase-js-2.118.0.esm.js', './site.webmanifest',
                     './favicon.svg' + ICON_V, './apple-touch-icon.png' + ICON_V, './icon-192.png' + ICON_V, './icon-512.png' + ICON_V];

// One missing file must not stop the new version from installing.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL)
    .then(c => Promise.all(SHELL_FILES.map(u => fetch(new Request(u, { cache: 'reload' }))
      .then(res => res.ok ? c.put(u, res) : null).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA && k !== SHEETS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const keep = (cache, req, res) => { if (res && res.ok && res.type !== 'opaque') { const copy = res.clone(); caches.open(cache).then(c => c.put(req, copy)); } return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch writes
  const url = new URL(req.url);

  // the page itself: always try the network first so a new deploy shows up at once
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(res => { if (res.ok && url.origin === location.origin) keep(SHELL, './index.html', res); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }

  if (url.hostname.endsWith('.supabase.co')) {
    // only table reads are worth keeping; everything else goes straight through
    if (!url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/rest/v1/usage_log') || url.pathname.startsWith('/rest/v1/rpc/')) return;
    e.respondWith(fetch(req)
      .then(res => keep(DATA, req, res))
      .catch(() => caches.match(req).then(hit => hit || Response.error())));
    return;
  }

  // same-origin app shell: cache first, then refresh quietly
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(res => keep(SHELL, req, res)).catch(() => hit);
      return hit || net;
    }));
  }
});
