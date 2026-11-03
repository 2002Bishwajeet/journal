// The app moved from / to /app/ (#913), with a service worker of its own there. A browser
// that ran the app at / still has the old worker on scope /, which serves the old app's
// shell at /. When it checks for an update it gets this file instead: this worker removes
// the old worker's precache and itself, then reloads the pages it had, so / is the landing
// page again (which sends a signed-in visitor to /app/).
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Workbox names its precache after the scope: only the old app's, not /app/'s.
      await caches.delete(`workbox-precache-v2-${self.registration.scope}`);
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
