// Bump this version whenever a cached app-shell asset changes.
const CACHE_NAME = "qr-lens-shell-v98";
const APP_SHELL = ["./", "./index.html", "./js/app.js", "./js/camera.js", "./js/image.js", "./js/scan.js", "./js/pdf.js", "./js/pdf-view.js", "./vendor/pdfjs-6.4.299/assets.json", "./js/locator.js", "./js/detection-debug.js", "./js/qr.js", "./vendor/jsQR-1.4.0.min.js", "./i18n/i18n.js", "./i18n/en.json", "./i18n/pt.json", "./i18n/es.json", "./styles/base.css", "./styles/layout.css", "./styles/components.css", "./manifest.webmanifest", "./assets/images/icon.svg", "./assets/images/icon-192.png", "./assets/images/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const response = await fetch("./vendor/pdfjs-6.4.299/assets.json");
    if (!response.ok) throw new Error("Could not load PDF asset manifest");
    const pdfAssets = await response.json();
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...APP_SHELL, ...pdfAssets]);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then(response => {
    if (new URL(event.request.url).origin !== self.location.origin) return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
