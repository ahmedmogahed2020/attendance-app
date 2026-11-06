const CACHE = 'attendance-v12';
const FILES = ['./', 'index.html', 'app.js', 'engine.js', 'vendor/xlsx.full.min.js', 'vendor/jspdf.umd.min.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png', 'fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2', 'fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2', 'fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2', 'fonts/ibm-plex-sans-arabic-latin-400-normal.woff2', 'fonts/ibm-plex-sans-arabic-latin-600-normal.woff2', 'fonts/reem-kufi-arabic-500-normal.woff2', 'fonts/reem-kufi-arabic-700-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
// الشبكة أولًا عشان التحديثات توصل، ولو مفيش نت يشتغل من المحفوظ
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
