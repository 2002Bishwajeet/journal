/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
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

// Network-first for API requests
registerRoute(
    ({ url }) => url.pathname.startsWith('/api/'),
    new NetworkFirst({
        cacheName: 'api-cache',
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

// Image proxy handler for COEP compliance
// Proxies external images to add Cross-Origin-Resource-Policy header
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Handle image proxy requests: /proxy-image/{encoded-url}
    if (url.pathname.startsWith('/proxy-image/')) {
        event.respondWith(handleImageProxy(event.request));
        return;
    }
});

async function handleImageProxy(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const encodedUrl = url.pathname.replace('/proxy-image/', '');

    // Decode the external URL
    let externalUrl: string;
    try {
        externalUrl = decodeURIComponent(encodedUrl);
    } catch {
        return new Response('Invalid URL encoding', { status: 400 });
    }

    // Validate it's a proper URL
    try {
        new URL(externalUrl);
    } catch {
        return new Response('Invalid URL', { status: 400 });
    }

    // Check cache first
    try {
        const cache = await caches.open('proxied-images');
        const cachedResponse = await cache.match(externalUrl);
        if (cachedResponse) {
            return cachedResponse;
        }
    } catch (cacheError) {
        console.warn('Cache access failed:', cacheError);
    }

    try {
        // Fetch the external image
        const response = await fetch(externalUrl, {
            mode: 'cors',
            credentials: 'omit',
        });

        if (!response.ok) {
            return new Response(`Failed to fetch image: ${response.status}`, {
                status: response.status
            });
        }

        // Clone the response to add CORP header
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

        // Create new response with modified headers
        const modifiedResponse = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });

        // Cache the response for future use
        try {
            const cache = await caches.open('proxied-images');
            const clonedResponse = modifiedResponse.clone();
            await cache.put(externalUrl, clonedResponse);
        } catch (cacheError) {
            console.warn('Failed to cache response:', cacheError);
        }

        return modifiedResponse;
    } catch (error) {
        console.error('Image proxy error:', error);
        return new Response('Failed to proxy image', { status: 500 });
    }
}

// Handle service worker activation
self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            // Clean up old caches
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames
                    .filter((name) => !['static-resources', 'images', 'api-cache', 'proxied-images'].includes(name) && !name.startsWith('webllm'))
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
