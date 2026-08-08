/**
 * Offline support. The app shell is precached so a gym with no signal still
 * loads the app; all match data lives in localStorage and never leaves the
 * device, so there is nothing to sync.
 *
 * Bump CACHE_NAME whenever a shell file changes so clients pick up the update.
 */

const CACHE_NAME = 'vbstats-v2';

const SHELL = [
    './',
    './index.html',
    './roster.json',
    './manifest.webmanifest',
    './css/app.css',
    './js/app.js',
    './js/model.js',
    './js/stats.js',
    './js/store.js',
    './js/ui/dom.js',
    './js/ui/court.js',
    './js/ui/roster.js',
    './js/ui/statsview.js',
    './js/ui/log.js',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    // Navigations fall back to the cached shell when offline.
    if (request.mode === 'navigate') {
        event.respondWith(fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true })));
        return;
    }

    // The shared roster is the one file that must not be served stale, or a
    // roster change published on GitHub would never reach anyone's phone. Go to
    // the network first and keep the last good copy for offline use.
    if (new URL(request.url).pathname.endsWith('/roster.json')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request, { ignoreSearch: true })),
        );
        return;
    }

    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                // Cache same-origin successes so later visits work offline too.
                if (response.ok && new URL(request.url).origin === self.location.origin) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            });
        }),
    );
});
