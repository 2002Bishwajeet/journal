import {
    buildHeadTags,
    fetchShareMeta,
    injectShareMeta,
    parseSharePath,
    type ShareMeta,
} from '../_lib/shareMeta';
import type { ShareContext } from '../_lib/types';

// Serves the SPA shell for /share/* with the note's own title, description,
// image and author in the head, so link previews (Slack, X, iMessage, …) show
// the note. Every user agent gets the same bytes. Any failure serves the plain
// shell: a share link never errors because of this.
export async function onRequest(context: ShareContext): Promise<Response> {
    const { request, env } = context;
    if (request.method !== 'GET' && request.method !== 'HEAD') return context.next();

    // '/', not '/index.html' (Pages 308s that). ASSETS applies _headers (COEP/COOP).
    const shell = await env.ASSETS.fetch(new URL('/', request.url));

    try {
        const url = new URL(request.url);
        const parsed = parseSharePath(url.pathname);
        if (!parsed || !shell.ok) return shell;

        const meta = await getShareMeta(context, parsed.identity, parsed.noteId);
        if (!meta) return shell;

        const html = injectShareMeta(
            await shell.clone().text(),
            buildHeadTags(meta, url.origin + url.pathname, url.origin),
        );
        const headers = new Headers(shell.headers);
        headers.delete('content-length');
        headers.delete('etag');
        headers.set('content-type', 'text/html; charset=utf-8');
        headers.set('cache-control', 'no-cache');
        return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
    } catch {
        return shell;
    }
}

async function getShareMeta(context: ShareContext, identity: string, noteId: string): Promise<ShareMeta | null> {
    // The Cache API may be unavailable (e.g. on *.pages.dev); that must not matter.
    const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
    const key = new Request(`https://share-meta.invalid/${identity}/${noteId}`);

    try {
        const hit = await cache?.match(key);
        if (hit) {
            const cached = (await hit.json()) as ShareMeta | { missing: true };
            return 'missing' in cached ? null : cached;
        }
    } catch {
        // Treat as a miss.
    }

    const meta = await fetchShareMeta(identity, noteId, fetch, context.env.HOMEBASE_UPSTREAM_OVERRIDE);
    try {
        if (cache) {
            context.waitUntil(
                cache
                    .put(
                        key,
                        new Response(JSON.stringify(meta ?? { missing: true }), {
                            headers: { 'cache-control': meta ? 'max-age=300' : 'max-age=60' },
                        }),
                    )
                    .catch(() => undefined),
            );
        }
    } catch {
        // Caching is best-effort.
    }
    return meta;
}
