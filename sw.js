/**
 * Offline support.
 *
 * The strategy is network-first with a cache fallback, on purpose. Cache-first
 * is the usual advice for an app shell, but it means a freshly published change
 * is invisible until the second launch, and it made every deploy depend on
 * remembering to bump a version constant by hand. Here, if the phone has a
 * connection it gets the current files; if it does not — the normal case in a
 * gym — it gets the last copy it saw, which is the whole point of the cache.
 *
 * The network attempt is raced against a short timeout so a barely-there
 * connection falls back to the cache rather than hanging on the splash screen.
 *
 * CACHE_NAME no longer needs bumping to ship an update. It exists only to
 * invalidate everything at once if the cached shape ever needs a clean break.
 */

const CACHE_NAME = 'vbstats-v3';

/** How long to wait for the network before serving the cached copy. */
const NETWORK_TIMEOUT_MS = 3500;

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
    './js/version.js',
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
            // Individually, so one missing file cannot fail the whole install
            // and leave the app with no offline copy at all.
            .then((cache) =>
                Promise.all(
                    SHELL.map((path) =>
                        cache.add(path).catch((error) => console.warn('Precache skipped', path, error)),
                    ),
                ),
            )
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

/** Let the page ask the worker to step aside immediately. */
self.addEventListener('message', (event) => {
    if (event.data === 'skip-waiting') self.skipWaiting();
});

/**
 * Fetch from the network, falling back to the cache on failure or if the
 * network is too slow to be useful. Successful responses refresh the cache.
 */
function networkFirst(request, fallbackKey = request) {
    const fromCache = () => caches.match(fallbackKey, { ignoreSearch: true });

    const network = fetch(request).then((response) => {
        if (response.ok && new URL(request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
    });

    const timeout = new Promise((resolve) => {
        setTimeout(() => resolve(fromCache().then((cached) => cached ?? network)), NETWORK_TIMEOUT_MS);
    });

    return Promise.race([network, timeout]).catch(() => fromCache());
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const sameOrigin = new URL(request.url).origin === self.location.origin;
    if (!sameOrigin) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, './index.html'));
        return;
    }

    event.respondWith(networkFirst(request));
});
