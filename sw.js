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
 *
 * **Every fetch here bypasses the HTTP cache**, and that is load-bearing rather
 * than belt-and-braces. GitHub Pages serves with `Cache-Control: max-age=600`,
 * so a plain `fetch()` is answered from the browser's own cache for ten minutes
 * without touching the network — and this worker would then write that stale
 * response back into the offline cache as if it were current. "Network-first"
 * silently meant "HTTP-cache-first", and a freshly published update was
 * invisible for ten minutes no matter how many times you pressed Check for
 * update. Reproduced and fixed in 2026.10.22b.
 *
 * This file itself was never the problem — `updateViaCache` defaults to
 * `'imports'`, so the browser already refetches the top-level worker script on
 * every update check. `app.js` now passes `'none'` anyway, which extends the
 * same rule to anything the worker might one day `importScripts`.
 */

const CACHE_NAME = 'vbstats-v3';

/** How long to wait for the network before serving the cached copy. */
const NETWORK_TIMEOUT_MS = 3500;

const SHELL = [
    './',
    './index.html',
    './trends.html',
    './roster.json',
    './manifest.webmanifest',
    './css/app.css',
    // Every module, without exception. `libero.js`, `formations.js` and
    // `ui/subs.js` were each missed when they shipped and only worked offline
    // because the fetch handler caches what it serves — so an install that
    // never ran online would die on the *first* import, not on the tab that
    // needed them. Add the file here in the same change that creates it.
    './js/app.js',
    './js/trends.js',
    './js/model.js',
    './js/stats.js',
    './js/store.js',
    './js/version.js',
    './js/libero.js',
    './js/formations.js',
    './js/plan.js',
    './js/season.js',
    './js/report.js',
    './js/subring.js',
    './js/ui/dom.js',
    './js/ui/chart.js',
    './js/ui/court.js',
    './js/ui/subs.js',
    './js/ui/subring.js',
    './js/ui/whiteboard.js',
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
                    // `cache.add` would fetch through the HTTP cache, which is
                    // how a brand-new worker ends up precaching the files the
                    // old one was already serving.
                    SHELL.map((path) =>
                        fetch(path, { cache: 'no-store' })
                            .then((response) => (response.ok ? cache.put(path, response) : null))
                            .catch((error) => console.warn('Precache skipped', path, error)),
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
    /**
     * The page that was asked for, and only then the shell.
     *
     * A navigation passes `./index.html` as the fallback so an unvisited deep
     * link still opens the app rather than the browser's dinosaur. Checking
     * the cache for the requested page *first* matters now that the app links
     * to `trends.html`: offline, the fallback alone served the capture app
     * under the dashboard's URL.
     */
    const fromCache = async () =>
        (await caches.match(request, { ignoreSearch: true })) ??
        (await caches.match(fallbackKey, { ignoreSearch: true }));

    const network = fetch(request, { cache: 'no-store' }).then((response) => {
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
