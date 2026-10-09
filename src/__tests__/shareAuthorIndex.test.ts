/**
 * #515: /share/<identity> and /share/<identity>/sitemap.xml list the author's
 * public, indexable notes, rendered by the /share/* Pages Function; any
 * failure there is a 404, never the SPA shell.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOURNAL_DRIVE, JOURNAL_FILE_TYPE as APP_FILE_TYPE } from '@/lib/homebase/config';
import {
    JOURNAL_FILE_TYPE,
    buildAuthorIndexHtml,
    buildSitemapXml,
    fetchAuthorIndex,
    parseAuthorPath,
    type AuthorIndex,
} from '../../functions/_lib/authorIndex';
import { onRequest } from '../../functions/share/[[path]]';
import type { ShareContext } from '../../functions/_lib/types';

const IDENTITY = 'frodo.dotyou.cloud';
const ORIGIN = 'https://journal.test';
const id = (n: number) => `11111111-1111-1111-1111-${String(n).padStart(12, '0')}`;

function file(
    n: number,
    {
        title = `Note ${n}`,
        indexable = true as unknown,
        isEncrypted = false,
        archivalStatus = 0,
        userDate = Date.UTC(2026, 0, n),
        uniqueId = id(n) as unknown,
        content,
    }: {
        title?: string;
        indexable?: unknown;
        isEncrypted?: boolean;
        archivalStatus?: number;
        userDate?: number;
        uniqueId?: unknown;
        content?: unknown;
    } = {},
) {
    return {
        fileId: `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`,
        fileMetadata: {
            created: Date.UTC(2025, 0, 1),
            updated: userDate + 3_600_000,
            isEncrypted,
            appData: {
                uniqueId,
                userDate,
                archivalStatus,
                content: content ?? JSON.stringify({ title, isPublic: true, card: { indexable } }),
            },
        },
    };
}

/** A fetch mock that answers the query and profile endpoints and records URLs. */
function mockFetch(
    query: { status: number; body?: unknown },
    profile: { status: number; body?: unknown } = { status: 200, body: { name: 'Frodo' } },
) {
    const urls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        const res = url.includes('/pub/profile') ? profile : query;
        return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status });
    });
    return { impl: impl as unknown as typeof fetch, urls };
}

function index(overrides: Partial<AuthorIndex> = {}): AuthorIndex {
    return {
        identity: IDENTITY,
        authorName: 'Frodo',
        notes: [
            { noteId: id(2), title: 'Second', published: '2026-01-02T00:00:00.000Z', modified: '2026-01-05T00:00:00.000Z' },
            { noteId: id(1), title: 'First', published: '2026-01-01T00:00:00.000Z' },
        ],
        ...overrides,
    };
}

describe('author index constants', () => {
    it('should match the app file type', () => {
        expect(JOURNAL_FILE_TYPE).toBe(APP_FILE_TYPE);
    });
});

describe('parseAuthorPath', () => {
    it('should accept /share/<identity>, with or without a trailing slash, and its sitemap', () => {
        expect(parseAuthorPath('/share/Frodo.dotyou.cloud')).toEqual({ identity: IDENTITY, kind: 'index' });
        expect(parseAuthorPath('/share/frodo.dotyou.cloud/')).toEqual({ identity: IDENTITY, kind: 'index' });
        expect(parseAuthorPath('/share/frodo.dotyou.cloud/sitemap.xml')).toEqual({ identity: IDENTITY, kind: 'sitemap' });
    });

    it.each(['/share/localhost', '/share/127.0.0.1/', '/share/%E0%A4%A/sitemap.xml'])(
        'should flag %s as an author path with no valid identity',
        (path) => {
            expect(parseAuthorPath(path)?.identity).toBeNull();
        },
    );

    it.each([`/share/a.b/${id(1)}`, '/share/a.b/sitemap.xml/', '/share/', '/share-target', '/share/a.b/robots.txt'])(
        'should leave %s to the note page',
        (path) => {
            expect(parseAuthorPath(path)).toBeNull();
        },
    );
});

describe('fetchAuthorIndex', () => {
    it('should list only public, indexable notes, newest first', async () => {
        const { impl } = mockFetch({
            status: 200,
            body: {
                searchResults: [
                    file(1),
                    file(3),
                    file(4, { indexable: false }),
                    file(5, { indexable: 'true' }),
                    file(6, { content: JSON.stringify({ title: 'No card' }) }),
                    file(7, { isEncrypted: true, content: 'ZW5jcnlwdGVk' }),
                    file(8, { archivalStatus: 2 }),
                    file(9, { uniqueId: 'not-a-guid' }),
                    file(10, { content: '{broken' }),
                    file(2, { content: { title: 'Already parsed', card: { indexable: true } } }),
                ],
            },
        });
        const result = await fetchAuthorIndex(IDENTITY, impl);
        expect(result?.authorName).toBe('Frodo');
        expect(result?.notes.map((n) => n.noteId)).toEqual([id(3), id(2), id(1)]);
        expect(result?.notes[1]).toEqual({
            noteId: id(2),
            title: 'Already parsed',
            published: '2026-01-02T00:00:00.000Z',
            modified: '2026-01-02T01:00:00.000Z',
        });
    });

    it('should query the journal drive as a guest for up to 500 active notes', async () => {
        const { impl, urls } = mockFetch({ status: 200, body: { searchResults: [] } });
        await fetchAuthorIndex(IDENTITY, impl);
        const query = new URL(urls.find((u) => u.includes('/drive/query/batch'))!);
        expect(query.origin).toBe(`https://${IDENTITY}`);
        expect(query.pathname).toBe('/api/guest/v1/drive/query/batch');
        expect(Object.fromEntries(query.searchParams)).toMatchObject({
            alias: JOURNAL_DRIVE.alias,
            type: JOURNAL_DRIVE.type,
            fileType: '605',
            fileState: '1',
            maxRecords: '500',
            includeMetadataHeader: 'true',
        });
        expect(urls).toContain(`https://${IDENTITY}/pub/profile`);
    });

    it('should use the override base when one is passed', async () => {
        const { impl, urls } = mockFetch({ status: 200, body: { searchResults: [] } });
        await fetchAuthorIndex(IDENTITY, impl, 'http://127.0.0.1:8799/');
        expect(urls.every((u) => u.startsWith('http://127.0.0.1:8799/'))).toBe(true);
    });

    it('should fall back to the identity as author when the profile fails', async () => {
        const { impl } = mockFetch({ status: 200, body: { searchResults: [] } }, { status: 500 });
        expect((await fetchAuthorIndex(IDENTITY, impl))?.authorName).toBe(IDENTITY);
    });

    it.each([
        ['a non-200 query', { status: 403, body: {} }],
        ['a body without searchResults', { status: 200, body: { error: 'x' } }],
        ['a non-JSON body', { status: 200, body: undefined }],
    ])('should return null for %s', async (_, query) => {
        expect(await fetchAuthorIndex(IDENTITY, mockFetch(query).impl)).toBeNull();
    });
});

describe('buildAuthorIndexHtml', () => {
    it('should list each note with its title, date and link, with canonical and og tags', () => {
        const html = buildAuthorIndexHtml(index(), ORIGIN);
        expect(html).toContain('<title>Notes by Frodo · Journal</title>');
        expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/share/${IDENTITY}" />`);
        expect(html).toContain('property="og:title" content="Notes by Frodo"');
        expect(html).toContain(`property="og:url" content="${ORIGIN}/share/${IDENTITY}"`);
        expect(html).toContain(`<a href="${ORIGIN}/share/${IDENTITY}/${id(2)}">Second</a>`);
        expect(html).toContain('<time datetime="2026-01-02T00:00:00.000Z">January 2, 2026</time>');
        expect(html.indexOf('Second')).toBeLessThan(html.indexOf('First'));
        expect(html).not.toContain('noindex');
        expect(html).not.toContain('<script');
    });

    it('should escape the author name and titles', () => {
        const html = buildAuthorIndexHtml(
            index({ authorName: '<b>Frodo</b>', notes: [{ noteId: id(1), title: '<img src=x onerror=alert(1)>' }] }),
            ORIGIN,
        );
        expect(html).not.toContain('<b>');
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('should say there are no notes, and not be indexed, when the list is empty', () => {
        const html = buildAuthorIndexHtml(index({ notes: [] }), ORIGIN);
        expect(html).toContain('No public notes listed.');
        expect(html).toContain('name="robots" content="noindex"');
    });
});

describe('buildSitemapXml', () => {
    it('should list each note URL with its last change', () => {
        const xml = buildSitemapXml(index(), ORIGIN);
        expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
        expect(xml).toContain(
            `<url><loc>${ORIGIN}/share/${IDENTITY}/${id(2)}</loc><lastmod>2026-01-05T00:00:00.000Z</lastmod></url>`,
        );
        expect(xml).toContain(
            `<url><loc>${ORIGIN}/share/${IDENTITY}/${id(1)}</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod></url>`,
        );
        expect(xml.match(/<url>/g)).toHaveLength(2);
    });
});

describe('author index in the share Pages Function', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function context(path: string, method = 'GET') {
        const assets = vi.fn(async () => new Response('<div id="root"></div>'));
        const ctx: ShareContext = {
            request: new Request(`${ORIGIN}${path}`, { method }),
            env: { ASSETS: { fetch: assets } },
            waitUntil: () => undefined,
            next: async () => new Response('next'),
        };
        return { ctx, assets };
    }

    const results = { status: 200, body: { searchResults: [file(1), file(2, { indexable: false })] } };

    it('should serve the index page as HTML without the SPA shell', async () => {
        vi.stubGlobal('fetch', mockFetch(results).impl);
        const { ctx, assets } = context(`/share/${IDENTITY}`);
        const res = await onRequest(ctx);
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(html).toContain(`/share/${IDENTITY}/${id(1)}`);
        expect(html).not.toContain(id(2));
        expect(html).not.toContain('id="root"');
        expect(assets).not.toHaveBeenCalled();
    });

    it('should serve the sitemap as XML', async () => {
        vi.stubGlobal('fetch', mockFetch(results).impl);
        const res = await onRequest(context(`/share/${IDENTITY}/sitemap.xml`).ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
        const xml = await res.text();
        expect(xml).toContain(`<loc>${ORIGIN}/share/${IDENTITY}/${id(1)}</loc>`);
        expect(xml).not.toContain(id(2));
    });

    it('should answer HEAD without a body', async () => {
        vi.stubGlobal('fetch', mockFetch(results).impl);
        const res = await onRequest(context(`/share/${IDENTITY}`, 'HEAD').ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('');
    });

    it.each([
        ['an upstream failure', `/share/${IDENTITY}`, { status: 500 }],
        ['an upstream failure on the sitemap', `/share/${IDENTITY}/sitemap.xml`, { status: 404 }],
    ])('should 404 on %s', async (_, path, query) => {
        vi.stubGlobal('fetch', mockFetch(query).impl);
        const res = await onRequest(context(path).ctx);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain('id="root"');
    });

    it('should 404 on a rejected fetch', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
        expect((await onRequest(context(`/share/${IDENTITY}`).ctx)).status).toBe(404);
    });

    it('should 404 on an invalid identity without fetching', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const res = await onRequest(context('/share/localhost').ctx);
        expect(res.status).toBe(404);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should cache a list for 5 minutes and a miss for 60 seconds', async () => {
        const puts: Array<{ key: string; cacheControl: string | null }> = [];
        const cache = {
            match: vi.fn(async () => undefined),
            put: vi.fn(async (req: Request, res: Response) => {
                puts.push({ key: req.url, cacheControl: res.headers.get('cache-control') });
            }),
        };
        vi.stubGlobal('caches', { default: cache });

        vi.stubGlobal('fetch', mockFetch(results).impl);
        await onRequest(context(`/share/${IDENTITY}`).ctx);
        vi.stubGlobal('fetch', mockFetch({ status: 500 }).impl);
        await onRequest(context('/share/sam.dotyou.cloud/sitemap.xml').ctx);

        expect(puts).toEqual([
            { key: `https://share-index.invalid/${IDENTITY}`, cacheControl: 'max-age=300' },
            { key: 'https://share-index.invalid/sam.dotyou.cloud', cacheControl: 'max-age=60' },
        ]);
    });

    it('should serve a cached list without fetching', async () => {
        const cached = index({ notes: [{ noteId: id(9), title: 'Cached' }] });
        vi.stubGlobal('caches', {
            default: { match: async () => new Response(JSON.stringify(cached)), put: async () => undefined },
        });
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const html = await (await onRequest(context(`/share/${IDENTITY}`).ctx)).text();
        expect(html).toContain('>Cached</a>');
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
