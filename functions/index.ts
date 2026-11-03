import type { ShareContext } from './_lib/types';

// / is the app for a browser that is signed in, and the landing page for everyone else (#913).
// The app sets the journal_session cookie on sign-in and on every signed-in boot and clears it
// on logout (src/lib/sessionHint.ts). It is a routing hint, never auth: the app still checks its
// own token. Only a request that accepts HTML (a page load, a crawler) gets the landing page: the
// service worker's precache fetches '/' with Accept */*, and it must always get the app's shell.
// /index.html is a static file, which Pages 308s to / (so it comes here); every other path is
// unchanged (public/_routes.json).
export async function onRequest({ request, env, next }: ShareContext): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();

    const signedIn = /(?:^|;\s*)journal_session=/.test(request.headers.get('Cookie') ?? '');
    const wantsHtml = (request.headers.get('Accept') ?? '').includes('text/html');
    // '/' and '/landing/', not their index.html (Pages 308s that). ASSETS applies _headers.
    const page = signedIn || !wantsHtml ? '/' : '/landing/';
    const asset = await env.ASSETS.fetch(new URL(page, request.url));

    const headers = new Headers(asset.headers);
    headers.set('Cache-Control', 'private, no-cache');
    headers.set('Vary', 'Cookie, Accept');
    return new Response(asset.body, { status: asset.status, headers });
}
