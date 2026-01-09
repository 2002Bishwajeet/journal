/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute, Route } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare let self: ServiceWorkerGlobalScope & {
    __WB_DISABLE_DEV_LOGS: boolean;
};

// Disable Workbox development logs
self.__WB_DISABLE_DEV_LOGS = true;

// Precache static assets injected by VitePWA
precacheAndRoute(self.__WB_MANIFEST);

// Cleanup old caches
cleanupOutdatedCaches();

// Cache static assets (JS, CSS, images)
registerRoute(
    ({ request }) =>
        request.destination === 'style' ||
        request.destination === 'script' ||
        request.destination === 'worker',
    new CacheFirst({
        cacheName: 'static-resources',
        plugins: [
            new CacheableResponsePlugin({
                statuses: [0, 200],
            }),
            new ExpirationPlugin({
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            }),
        ],
    })
);

// Cache images
registerRoute(
    ({ request }) => request.destination === 'image',
    new CacheFirst({
        cacheName: 'images',
        plugins: [
            new CacheableResponsePlugin({
                statuses: [0, 200],
            }),
            new ExpirationPlugin({
                maxEntries: 200,
                maxAgeSeconds: 60 * 24 * 60 * 60, // 60 days
            }),
        ],
    })
);

// Network-first for API requests with proper offline fallback
registerRoute(
    ({ url }) => url.pathname.startsWith('/api/'),
    new NetworkFirst({
        cacheName: 'api-cache',
        networkTimeoutSeconds: 10, // Timeout after 10 seconds
        plugins: [
            new CacheableResponsePlugin({
                statuses: [0, 200],
            }),
            new ExpirationPlugin({
                maxEntries: 50,
                maxAgeSeconds: 24 * 60 * 60, // 1 day
            }),
        ],
    })
);

// Image proxy handler with proper offline support
// Uses Workbox's CacheFirst with custom handler for COEP compliance
registerRoute(
    ({ url }) => url.pathname.startsWith('/proxy-image/'),
    new Route(
        ({ url }) => url.pathname.startsWith('/proxy-image/'),
        async ({ request }) => {
            const url = new URL(request.url);
            const encodedUrl = url.pathname.replace('/proxy-image/', '');

            let externalUrl: string;
            try {
                externalUrl = decodeURIComponent(encodedUrl);
            } catch {
                return new Response('Invalid URL encoding', { status: 400 });
            }

            try {
                new URL(externalUrl);
            } catch {
                return new Response('Invalid URL', { status: 400 });
            }

            // Check cache first (critical for offline support)
            try {
                const cache = await caches.open('proxied-images');
                const cachedResponse = await cache.match(externalUrl);
                if (cachedResponse) {
                    return cachedResponse;
                }
            } catch {
                // Cache access failed, continue to network
            }

            // If offline, return a placeholder response instead of throwing
            if (!navigator.onLine) {
                return new Response('Image unavailable offline', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }

            try {
                const response = await fetch(externalUrl, {
                    mode: 'cors',
                    credentials: 'omit',
                });

                if (!response.ok) {
                    return new Response(`Failed to fetch image: ${response.status}`, {
                        status: response.status
                    });
                }

                const headers = new Headers(response.headers);
                headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
                headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

                const modifiedResponse = new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers,
                });

                // Cache the response
                try {
                    const cache = await caches.open('proxied-images');
                    await cache.put(externalUrl, modifiedResponse.clone());
                } catch {
                    // Caching failed, but we can still return the response
                }

                return modifiedResponse;
            } catch (error) {
                // Network error - return a graceful offline response
                console.warn('[SW] Image proxy failed:', error);
                return new Response('Image unavailable', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            }
        }
    ).handler
);

// Cache Google Fonts with CacheFirst (they rarely change)
registerRoute(
    ({ url }) => url.origin === 'https://fonts.googleapis.com' ||
        url.origin === 'https://fonts.gstatic.com',
    new CacheFirst({
        cacheName: 'google-fonts',
        plugins: [
            new CacheableResponsePlugin({
                statuses: [0, 200],
            }),
            new ExpirationPlugin({
                maxEntries: 30,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
            }),
        ],
    })
);

// SPA Navigation Fallback: Serve index.html for all navigation requests
// This is essential for the PWA to work offline on non-root paths
registerRoute(
    new NavigationRoute(createHandlerBoundToURL('/index.html'), {
        denylist: [
            /^\/api\//, // Exclude API calls
            /^\/img\//, // Exclude images if needed
            /^\/proxy-image\//, // Exclude proxy image calls
        ],
    })
);

// Handle service worker activation
self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            // Clean up old caches
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames
                    .filter((name) => !['static-resources', 'images', 'api-cache', 'proxied-images', 'google-fonts'].includes(name) && !name.startsWith('webllm') && !name.startsWith('workbox-'))
                    .map((name) => caches.delete(name))
            );

            // Take control of all clients
            await self.clients.claim();
        })()
    );
});

// Handle skip waiting message
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
