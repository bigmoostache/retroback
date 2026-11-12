// Service worker of the Retroback web app: makes it installable and lets the
// shell open offline. Data is never cached: /api and /auth always go to the
// network, so what is shown is what the engine says.
const VERSION = "rb-v1"
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return

  // Pages: the network first, so a new build shows at once; the cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(VERSION).then((cache) => cache.put("/", copy))
          return response
        })
        .catch(() => caches.match("/")),
    )
    return
  }

  // Built assets have a hash in their name: once cached, they never change.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith("/assets/")) {
            const copy = response.clone()
            void caches.open(VERSION).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
