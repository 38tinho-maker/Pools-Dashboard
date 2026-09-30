// Guarda os arquivos da página para abrir rápido; os dados da conta vêm sempre da Hyperliquid (nunca do cache).
const CACHE = 'radar-mobile-v17';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'lib/hyperliquid.js', 'lib/hltrades.js', 'lib/partials.js', 'lib/runext.js', 'lib/i18n.js', 'lib/finished.js', 'lib/format.js', 'icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // API da Hyperliquid: direto na rede
  // rede primeiro (pega as atualizações da página), cache se estiver sem internet
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
