import {
    buildHeadTags,
    fetchShareMeta,
    injectShareMeta,
    parseSharePath,
} from '../_lib/shareMeta';
import { buildAuthorIndexHtml, buildSitemapXml, fetchAuthorIndex, parseAuthorPath } from '../_lib/authorIndex';
import type { ShareContext } from '../_lib/types';

// Serves the SPA shell for /share/* with the note's own title, description,
// image and author in the head, so link previews (Slack, X, iMessage, …) show
// the note. Every user agent gets the same bytes. Any failure serves the plain
// shell: a share link never errors because of this.
// /share/<identity> and /share/<identity>/sitemap.xml are the author's index
// instead (#515), rendered here; any failure there is a 404.
export async function onRequest(context: ShareContext): Promise<Response> {
    const { request, env } = context;
    if (request.method !== 'GET' && request.method !== 'HEAD') return context.next();

    const authorPath = parseAuthorPath(new URL(request.url).pathname);
    if (authorPath) return serveAuthorIndex(context, authorPath);

    // '/', not '/index.html' (Pages 308s that). ASSETS applies _headers (COEP/COOP).
    const shell = await env.ASSETS.fetch(new URL('/', request.url));

    try {
        const url = new URL(request.url);
        const parsed = parseSharePath(url.pathname);
        if (!parsed || !shell.ok) return shell;

        const meta = await cached(context, `https://share-meta.invalid/${parsed.identity}/${parsed.noteId}`, () =>
            fetchShareMeta(parsed.identity, parsed.noteId, fetch, env.HOMEBASE_UPSTREAM_OVERRIDE),
        );
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
        if (!meta.indexable) headers.set('x-robots-tag', 'noindex');
        return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
    } catch {
        return shell;
    }
}

async function serveAuthorIndex(
    context: ShareContext,
    { identity, kind }: { identity: string | null; kind: 'index' | 'sitemap' },
): Promise<Response> {
    const notFound = () =>
        new Response('Not found', {
            status: 404,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' },
        });
    try {
        if (!identity) return notFound();
        const index = await cached(context, `https://share-index.invalid/${identity}`, () =>
            fetchAuthorIndex(identity, fetch, context.env.HOMEBASE_UPSTREAM_OVERRIDE),
        );
        if (!index) return notFound();

        const origin = new URL(context.request.url).origin;
        const body = kind === 'sitemap' ? buildSitemapXml(index, origin) : buildAuthorIndexHtml(index, origin);
        return new Response(context.request.method === 'HEAD' ? null : body, {
            status: 200,
            headers: {
                'content-type': kind === 'sitemap' ? 'application/xml; charset=utf-8' : 'text/html; charset=utf-8',
                'cache-control': 'no-cache',
            },
        });
    } catch {
        return notFound();
    }
}

/** `load()`, cached for 5 min (60 s for a null). */
async function cached<T extends object>(context: ShareContext, key: string, load: () => Promise<T | null>): Promise<T | null> {
    // The Cache API may be unavailable (e.g. on *.pages.dev); that must not matter.
    const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
    const request = new Request(key);

    try {
        const hit = await cache?.match(request);
        if (hit) {
            const value = (await hit.json()) as T | { missing: true };
            return 'missing' in value ? null : value;
        }
    } catch {
        // Treat as a miss.
    }

    const value = await load();
    try {
        if (cache) {
            context.waitUntil(
                cache
                    .put(
                        request,
                        new Response(JSON.stringify(value ?? { missing: true }), {
                            headers: { 'cache-control': value ? 'max-age=300' : 'max-age=60' },
                        }),
                    )
                    .catch(() => undefined),
            );
        }
    } catch {
        // Caching is best-effort.
    }
    return value;
}
