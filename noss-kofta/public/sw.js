// cashier-bridge POS — Service Worker لحفظ شكل الصفحة (app shell) على جهاز الكاشير
// عشان صفحة الكاشير تفتح من غير نت — حتى بعد ريفريش أو قفل المتصفح وفتحه تاني.
// مهم: لما تنزّل نسخة جديدة من الموقع غيّر رقم CACHE_VERSION تحت (مثلاً pos-shell-v2)
// عشان المتصفح يمسح الكاش القديم ويحفظ الشكل الجديد.
// القواعد:
//  - طلبات التنقّل (فتح الصفحة): الشبكة أولاً، ولو مفيش نت يرجع نسخة index.html المحفوظة.
//    يعني عمره ما يعرض نسخة قديمة طول ما النت شغال.
//  - الملفات الثابتة (.js / .css / صور / خطوط) من نفس الموقع: من الكاش أولاً مع تحديث
//    في الخلفية (stale-while-revalidate).
//  - طلبات /api/* والبرنامج المحلي (127.0.0.1) مبتتلمسش خالص — بتروح للشبكة وتفشل
//    أوفلاين زي قبل كده، وطابور الأوفلاين الموجود هو اللي بيتعامل معاها.
'use strict';

const CACHE_VERSION = 'pos-shell-v1';
const SHELL_CACHE = CACHE_VERSION;
const STATIC_RE = /\.(?:js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|json|webmanifest)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.add('/index.html'))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 1) الـ API عمره ما يتخزّن ولا يتقاطع — يروح للشبكة على طول.
  if (url.pathname.startsWith('/api/')) return;
  // 2) بس ملفات نفس الموقع (البرنامج المحلي والـ CDNs برّه الحسبة).
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || accept.indexOf('text/html') !== -1) {
    // 3) فتح الصفحة: الشبكة أولاً، والكاش احتياطي لو مفيش نت.
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (STATIC_RE.test(url.pathname)) {
    // 4) ملف ثابت: من الكاش لو موجود، وحدّثه في الخلفية من الشبكة.
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
