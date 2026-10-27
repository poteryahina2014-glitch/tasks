// Нужен, чтобы приложение устанавливалось и открывалось без интернета.
// Свои файлы — сначала из сети, мимо кэша браузера (GitHub Pages кэширует на 10 минут), без сети — из кэша.
// Запросы к Supabase не трогаем.
const CACHE = 'tasks-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.json', 'icons/icon-192.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request, { cache: 'no-cache' })
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});

// Уведомления с сервера (функция notify в Supabase).
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data.json(); } catch { m = { title: 'Задачи', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Задачи', {
    body: m.body || '', tag: m.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
  }));
});

// Нажатие на уведомление — открыть приложение (или переключиться на открытое).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(self.registration.scope));
    return w ? w.focus() : self.clients.openWindow('./');
  }));
});
