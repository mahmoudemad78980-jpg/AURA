/* ================================================================
   sw.js — Service Worker لمسرح الترددات المخفية
   · تخزين الملفات مسبقاً (pre-cache) وتشغيل التطبيق دون إنترنت
   · استراتيجية: الكاش أولاً ثم الشبكة (Cache-First) مع تحديث خلفي
   · تنظيف الإصدارات القديمة عند التفعيل
   ================================================================ */
"use strict";

const VERSION = "hft-v1.0.0";
const CACHE_NAME = `hft-cache-${VERSION}`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
];

/* ---------- التثبيت: تخزين كل الملفات ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // addAll يفشل كلياً إن فشل ملف واحد → نضيف كل ملف على حدة
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res && (res.ok || res.type === "opaque")) await cache.put(url, res);
          } catch (e) {
            console.warn("[SW] تعذّر تخزين:", url, e);
          }
        })
      );
      await self.skipWaiting();
    })
  );
});

/* ---------- التفعيل: حذف الكاش القديم ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- الجلب: الكاش أولاً + تحديث في الخلفية ---------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // نتجاوز المصادر الخارجية

  // التنقل بين الصفحات: نخدم index.html من الكاش فوراً (Offline-first)
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch (e) {
          const cached = await caches.match("./index.html", { ignoreSearch: true });
          return cached || new Response("غير متصل", { status: 503 });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        network; // تحديث الكاش في الخلفية
        return cached;
      }
      const fresh = await network;
      return fresh || new Response("", { status: 504 });
    })()
  );
});

/* ---------- رسالة من الصفحة: "تفعيل التحديث" ---------- */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
