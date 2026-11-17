// Streamify PWA Service Worker
const CACHE_NAME = "streamify-shell-v2";
const SHELL_ASSETS = [
  "/",
  "/manifest.json",
];

// Install: Cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch(() => undefined);
    })
  );
  self.skipWaiting();
});

// Activate: Clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Network first for API / audio streams, Cache-first for shell assets
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return;
  }

  // Do NOT intercept media or audio streaming calls; handled by IndexedDB or live HTTP range
  if (url.pathname.startsWith("/api/") || url.pathname.includes(".m3u8") || url.pathname.includes(".ts")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
        }
        return response;
      }).catch(() => caches.match("/"))
    );
    return;
  }

  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok && url.pathname.startsWith("/_next/static/")) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request))
  );
});

// Push Notifications Listener
self.addEventListener("push", (event) => {
  let data = { title: "New drop on Streamify", body: "Check out fresh tracks from artists you follow!" };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: data.url || "/",
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
