// 서비스 워커: 오프라인 실행(앱 껍데기 캐시) + 공유 시트 수신
const VERSION = 'v2.1.3-2026-11-10';
const SHELL = ['./', './index.html', './style.css', './config.js', './data.js', './vault.js', './classify.js', './google.js', './app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// 공유 시트로 들어온 내용을 IndexedDB 'inbox'에 잠시 보관 → 앱 잠금 해제 시 암호화 후 삭제
function inboxPut(entry) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('life-assistant', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox', { keyPath: 'id', autoIncrement: true });
    };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction('inbox', 'readwrite');
      t.objectStore('inbox').add(entry);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    };
  });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const files = [];
        for (const f of fd.getAll('files')) {
          if (f && typeof f === 'object') files.push({ name: f.name, type: f.type, blob: f });
        }
        await inboxPut({ title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '', files, at: Date.now() });
      } catch (err) { /* 실패해도 앱으로 이동 */ }
      return Response.redirect(new URL('./#/', self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // 뉴스: 네트워크 우선, 실패 시 마지막 사본
  if (url.pathname.endsWith('/news.json')) {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // 앱 껍데기: 캐시 우선
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
