/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute, Route } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { JOURNAL_APP_ID, JOURNAL_TEST_PUSH_TYPE_ID } from './lib/homebase/config';

declare let self: ServiceWorkerGlobalScope & {
    __WB_DISABLE_DEV_LOGS: boolean;
};

// Disable Workbox development logs
self.__WB_DISABLE_DEV_LOGS = true;

// Precache static assets injected by VitePWA
precacheAndRoute(self.__WB_MANIFEST);

// Cleanup old caches
cleanupOutdatedCaches();

// WebLLM runtime chunks (web-llm-*.js + its worker-*.js, ~12 MB) are no longer
// precached — AI is desktop-only and mobile can never run them. Cache them on
// first use in a small dedicated cache. Registered BEFORE the generic
// static-resources route below (Workbox: first matching route wins) so these
// large chunks land here, bounded to 4 entries, instead of consuming the shared
// static-resources budget. Trade-off: offline AI now requires having loaded AI
// once while online.
registerRoute(
    ({ url, sameOrigin }) =>
        sameOrigin && /\/assets\/(web-llm|worker)-.*\.js$/.test(url.pathname),
    new CacheFirst({
        cacheName: 'webllm-runtime',
        plugins: [
            new ExpirationPlugin({ maxEntries: 4 }),
        ],
    })
);

// The mermaid runtime chunk (mermaid-*.js) is not precached either: it loads
// only when a mermaid code block is previewed. Cached on first use, before the
// generic static-resources route so it doesn't count against that budget.
registerRoute(
    ({ url, sameOrigin }) =>
        sameOrigin && /\/assets\/mermaid-.*\.js$/.test(url.pathname),
    new CacheFirst({
        cacheName: 'mermaid-runtime',
        plugins: [
            new ExpirationPlugin({ maxEntries: 2 }),
        ],
    })
);

// A react block's React runtime and JSX compiler (#426), its Tailwind sheet and the libraries
// it may import (#427, #558) are not precached either: they load only when a react block is
// previewed, and are cached on first use so the block renders offline from then on. Chunk
// names: injectManifest.globIgnores in vite.config.ts.
registerRoute(
    ({ url, sameOrigin }) =>
        sameOrigin && /\/assets\/(_virtual_react-block-[\w-]+|reactBlockCompiler)-.*\.js$/.test(url.pathname),
    new CacheFirst({
        cacheName: 'react-block',
        plugins: [
            // Every piece (11), with room for its copy from the previous release.
            new ExpirationPlugin({ maxEntries: 22 }),
        ],
    })
);

// Cache same-origin static assets (JS, CSS, workers)
registerRoute(
    ({ request, sameOrigin }) =>
        sameOrigin && (
            request.destination === 'style' ||
            request.destination === 'script' ||
            request.destination === 'worker'
        ),
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

// Network-first for SAME-ORIGIN API requests with proper offline fallback.
// Scoped to sameOrigin so cross-origin identity-host /api/ responses (which come
// back opaque, status 0) are never cached; and status 200 only, to drop opaque
// responses entirely. Local data (PGlite) is the offline source of truth, so
// dropping cross-origin API caching doesn't break offline note access.
registerRoute(
    ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
    new NetworkFirst({
        cacheName: 'api-cache',
        networkTimeoutSeconds: 10, // Timeout after 10 seconds
        plugins: [
            new CacheableResponsePlugin({
                statuses: [200],
            }),
            new ExpirationPlugin({
                maxEntries: 50,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
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

// SPA Navigation Fallback: Serve index.html for all navigation requests
// This is essential for the PWA to work offline on non-root paths
registerRoute(
    // '/' not '/index.html': Cloudflare Pages 308s /index.html -> /, and a
    // redirected response served to a navigation is a network error. The
    // precache manifest is rewritten to match by manifestTransforms in
    // vite.config.ts — these two must change together, or this call throws at
    // service-worker startup.
    new NavigationRoute(createHandlerBoundToURL('/'), {
        denylist: [
            /^\/api\//, // Exclude API calls
            /^\/img\//, // Exclude images if needed
            /^\/proxy-image\//, // Exclude proxy image calls
            // An author's public index and sitemap (#515) and a shared folder's
            // page (#619) are rendered by the share Pages Function; the SPA has
            // no route for them. Note pages (/share/<identity>/<noteId>) still
            // get the shell.
            /^\/share\/[^/]+(\/sitemap\.xml|\/f\/[^/]+)?\/?(\?.*)?$/,
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
                    .filter((name) => !['static-resources', 'images', 'api-cache', 'proxied-images'].includes(name) && !name.startsWith('webllm') && !name.startsWith('mermaid') && name !== 'react-block' && !name.startsWith('workbox-'))
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

// Web push from the identity (#744). Payload: odin-core `PushNotificationContent`, serialized
// camelCase with GUIDs as lowercase dashed strings (OdinSystemSerializer, GuidConverter).
// The server sends every app's push to every subscription of the identity (no per-app filter),
// and with `userVisibleOnly` Chrome shows "This site has been updated in the background" for a
// push that shows nothing. So other apps' pushes get a generic notification, as in the owner
// console's service worker.
interface PushPayload {
    senderId: string;
    appDisplayName?: string;
    options: { appId: string; typeId: string; tagId: string; unEncryptedMessage?: string };
}

const isJournalPush = (p: PushPayload) =>
    p.options?.appId?.replace(/-/g, '').toLowerCase() === JOURNAL_APP_ID;

const otherAppNotification = (p: PushPayload) =>
    self.registration.showNotification(p.appDisplayName || 'Homebase', {
        body: `${p.senderId} sent you a notification via ${p.appDisplayName || 'Homebase'}`,
        tag: p.options?.tagId,
    });

self.addEventListener('push', (event) => {
    let payloads: PushPayload[] = [];
    try {
        payloads = (event.data?.json() as { payloads?: PushPayload[] })?.payloads ?? [];
    } catch {
        // Unreadable push: still show something (below)
    }
    const journal = payloads.filter(isJournalPush);
    event.waitUntil(
        (async () => {
            const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const payload of journal) {
                for (const client of windows) client.postMessage({ type: 'journal-push', payload });
            }
            const shown = payloads.map((p) =>
                isJournalPush(p)
                    ? self.registration.showNotification(p.senderId, {
                          body: p.options.unEncryptedMessage,
                          tag: p.options.tagId,
                          data: { senderId: p.senderId, typeId: p.options.typeId, tagId: p.options.tagId },
                      })
                    : otherAppNotification(p)
            );
            if (shown.length === 0) shown.push(self.registration.showNotification('Homebase', { body: 'You have a new notification' }));
            await Promise.all(shown);
        })()
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    // Other apps' notifications have no data, and a test push has no note: just bring Journal up
    const { senderId, typeId, tagId } = (event.notification.data ?? {}) as { senderId?: string; typeId?: string; tagId?: string };
    const url = tagId && typeId?.toLowerCase() !== JOURNAL_TEST_PUSH_TYPE_ID ? `/shared/${encodeURIComponent(tagId)}?from=${encodeURIComponent(senderId ?? '')}` : undefined;
    event.waitUntil(
        (async () => {
            const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            if (client) {
                await client.focus();
                // navigate() rejects for a window this worker does not control yet
                if (url) await client.navigate(url).catch(() => self.clients.openWindow(url));
            } else {
                await self.clients.openWindow(url ?? '/');
            }
        })()
    );
});
