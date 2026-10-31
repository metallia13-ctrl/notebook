/* StudyHub Notebook: service worker
   - file dell'app: prima la rete (così vedi subito gli aggiornamenti), poi la copia salvata se sei offline
   - librerie e font dai CDN: prima la copia salvata (hanno versioni fisse)
   - chiamate all'AI e a Drive: mai toccate */
const VERSION = 'nb-3.27';
const APP_CACHE = `${VERSION}-app`;
const CDN_CACHE = 'nb-cdn-1';
const SHARE_CACHE = 'nb-share';
const APP_FILES = ['./', './index.html', './app.js', './style.css', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js'
];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_TIMEOUT = 5000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES);
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_FILES.map(u => cdn.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [APP_CACHE, CDN_CACHE, SHARE_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('nb-') && !keep.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // PDF o testo condivisi da un’altra app (menu Condividi di Android)
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
});

async function receiveShare(req) {
  const scope = self.registration.scope;
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARE_CACHE);
    const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', file: null };
    const file = form.getAll('files').find(f => f && typeof f === 'object' && f.size > 0);
    if (file) {
      meta.file = { name: file.name || 'condiviso.pdf', type: file.type || 'application/pdf' };
      await cache.put(scope + '__share/file', new Response(file, { headers: { 'Content-Type': meta.file.type } }));
    }
    await cache.put(scope + '__share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) { /* l’app mostrerà il modulo vuoto */ }
  return Response.redirect(scope + 'index.html?shared=1', 303);
}

async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match(new URL('index.html', self.registration.scope).href);
      if (page) return page;
    }
    return new Response('Sei offline e questa risorsa non è salvata.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return new Response('', { status: 503 });
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
