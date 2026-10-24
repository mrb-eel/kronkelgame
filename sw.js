// Offline support: cache the game shell and assets on first visit, serve from cache afterwards,
// refresh in the background so updates arrive on the next launch.
const CACHE = 'kronkel-v1';
const CORE = [
  './', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './assets/layout.json', './assets/images/kronkel-logo.png', './assets/gamedata.json',
  './assets/models/shop.glb', './assets/models/people.glb', './assets/models/props.glb',
  './assets/fonts/Inter-Regular.woff2', './assets/fonts/Inter-Bold.woff2', './assets/fonts/Inter-ExtraBold.woff2',
  './assets/fonts/DejaVuSerif-Bold.ttf',
  './vendor/three/three.module.min.js', './vendor/three/three.core.min.js',
  './vendor/three/addons/loaders/GLTFLoader.js', './vendor/three/addons/utils/BufferGeometryUtils.js',
  './vendor/three/addons/utils/SkeletonUtils.js', './vendor/three/addons/libs/meshopt_decoder.module.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
