/**
 * #619: /share/<identity>/f/<folderId> lists a shared folder's public notes, rendered
 * by the /share/* Pages Function like the author index; an unshared or unknown
 * folder is a 404, never the SPA shell.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthorIndexHtml, fetchAuthorIndex, parseAuthorPath, type AuthorIndex } from '../../functions/_lib/authorIndex';
import { parseSharePath } from '../../functions/_lib/shareMeta';
import { onRequest } from '../../functions/share/[[path]]';
import type { ShareContext } from '../../functions/_lib/types';
import { folderShareUrl } from '@/lib/share/sharedFolder';

const IDENTITY = 'frodo.dotyou.cloud';
const ORIGIN = 'https://journal.test';
const FOLDER = '33333333-3333-3333-3333-333333333333';
const id = (n: number) => `11111111-1111-1111-1111-${String(n).padStart(12, '0')}`;

function note(n: number, groupId: unknown = FOLDER) {
    return {
        fileId: `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`,
        fileMetadata: {
            created: Date.UTC(2025, 0, 1),
            updated: Date.UTC(2026, 0, n, 1),
            isEncrypted: false,
            appData: {
                uniqueId: id(n),
                groupId,
                userDate: Date.UTC(2026, 0, n),
                archivalStatus: 0,
                content: JSON.stringify({ title: `Note ${n}`, isPublic: true, card: { indexable: true } }),
            },
        },
    };
}

const folderHeader = (content: unknown = { name: 'Blog', isPublic: true }, isEncrypted = false) => ({
    fileId: 'bbbbbbbb-0000-0000-0000-000000000001',
    fileMetadata: {
        isEncrypted,
        appData: { uniqueId: FOLDER, archivalStatus: 0, content: typeof content === 'string' ? content : JSON.stringify(content) },
    },
});

type Res = { status: number; body?: unknown };

/** A fetch mock for the notes query, the folder's header and the profile. */
function mockFetch({
    notes = { status: 200, body: { searchResults: [note(1), note(3), note(2)] } },
    folder = { status: 200, body: folderHeader() },
}: { notes?: Res; folder?: Res } = {}) {
    const urls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        const res: Res = url.includes('/pub/profile')
            ? { status: 200, body: { name: 'Frodo' } }
            : url.includes('/query/specialized/cuid/header')
              ? folder
              : notes;
        return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status });
    });
    return { impl: impl as unknown as typeof fetch, urls };
}

describe('parseAuthorPath for a folder', () => {
    it('should accept /share/<identity>/f/<folderId>, with or without a trailing slash', () => {
        const expected = { identity: IDENTITY, kind: 'folder', folderId: FOLDER };
        expect(parseAuthorPath(`/share/${IDENTITY}/f/${FOLDER}`)).toEqual(expected);
        expect(parseAuthorPath(`/share/Frodo.dotyou.cloud/f/${FOLDER.toUpperCase()}/`)).toEqual(expected);
    });

    it('should flag an invalid folder id or identity instead of falling through to the note page', () => {
        expect(parseAuthorPath(`/share/${IDENTITY}/f/not-a-guid`)).toEqual({ identity: IDENTITY, kind: 'folder', folderId: null });
        expect(parseAuthorPath(`/share/localhost/f/${FOLDER}`)).toEqual({ identity: null, kind: 'folder', folderId: FOLDER });
    });

    it.each([
        `/share/${IDENTITY}/f`,
        `/share/${IDENTITY}/f/`,
        `/share/${IDENTITY}/f/${FOLDER}/extra`,
        `/share/${IDENTITY}/x/${FOLDER}`,
        `/share/${IDENTITY}/f/${FOLDER}/sitemap.xml`,
    ])('should not treat %s as a folder page', (path) => {
        expect(parseAuthorPath(path)).toBeNull();
    });

    it('should leave the author index and the note page as they were', () => {
        expect(parseAuthorPath(`/share/${IDENTITY}`)).toEqual({ identity: IDENTITY, kind: 'index' });
        expect(parseAuthorPath(`/share/${IDENTITY}/sitemap.xml`)).toEqual({ identity: IDENTITY, kind: 'sitemap' });
        expect(parseAuthorPath(`/share/${IDENTITY}/${id(1)}`)).toBeNull();
        expect(parseSharePath(`/share/${IDENTITY}/${id(1)}`)).toEqual({ identity: IDENTITY, noteId: id(1) });
        expect(parseSharePath(`/share/${IDENTITY}/f/${FOLDER}`)).toBeNull();
    });
});

describe('folderShareUrl', () => {
    it('should build the folder page url', () => {
        expect(folderShareUrl(ORIGIN, IDENTITY, FOLDER)).toBe(`${ORIGIN}/share/${IDENTITY}/f/${FOLDER}`);
    });
});

describe('fetchAuthorIndex for a folder', () => {
    it('should list the folder notes, newest first, with the folder name', async () => {
        const result = await fetchAuthorIndex(IDENTITY, mockFetch().impl, undefined, FOLDER);
        expect(result?.folder).toEqual({ id: FOLDER, name: 'Blog' });
        expect(result?.authorName).toBe('Frodo');
        expect(result?.notes.map((n) => n.noteId)).toEqual([id(3), id(2), id(1)]);
    });

    it('should filter the notes query by groupId and read the folder file by its unique id', async () => {
        const { impl, urls } = mockFetch();
        await fetchAuthorIndex(IDENTITY, impl, undefined, FOLDER);
        const query = new URL(urls.find((u) => u.includes('/drive/query/batch'))!);
        expect(query.searchParams.get('groupId')).toBe(FOLDER);
        expect(query.searchParams.get('fileType')).toBe('605');
        const header = new URL(urls.find((u) => u.includes('/cuid/header'))!);
        expect(header.pathname).toBe('/api/guest/v1/drive/query/specialized/cuid/header');
        expect(header.searchParams.get('clientUniqueId')).toBe(FOLDER);
    });

    it('should not filter by group or read a folder for the author index', async () => {
        const { impl, urls } = mockFetch();
        const result = await fetchAuthorIndex(IDENTITY, impl);
        expect(result?.folder).toBeUndefined();
        expect(urls.some((u) => u.includes('groupId'))).toBe(false);
        expect(urls.some((u) => u.includes('/cuid/header'))).toBe(false);
    });

    it('should drop a note that says it is in another folder', async () => {
        const other = '44444444-4444-4444-4444-444444444444';
        const { impl } = mockFetch({
            notes: { status: 200, body: { searchResults: [note(1), note(2, other), note(3, FOLDER.toUpperCase()), note(4, undefined)] } },
        });
        const result = await fetchAuthorIndex(IDENTITY, impl, undefined, FOLDER);
        expect(result?.notes.map((n) => n.noteId).sort()).toEqual([id(1), id(3), id(4)]);
    });

    it.each([
        ['an unknown or unshared folder (guest read denied)', { status: 404 }],
        ['a folder file that is encrypted', { status: 200, body: folderHeader('c2VjcmV0', true) }],
        ['a folder not flagged public', { status: 200, body: folderHeader({ name: 'Blog' }) }],
        ['a folder without a name', { status: 200, body: folderHeader({ name: ' ', isPublic: true }) }],
        ['a folder file that is not JSON', { status: 200, body: folderHeader('{broken') }],
    ])('should return null for %s', async (_, folder) => {
        expect(await fetchAuthorIndex(IDENTITY, mockFetch({ folder }).impl, undefined, FOLDER)).toBeNull();
    });

    it('should return null when the notes query fails', async () => {
        expect(await fetchAuthorIndex(IDENTITY, mockFetch({ notes: { status: 500 } }).impl, undefined, FOLDER)).toBeNull();
    });
});

describe('buildAuthorIndexHtml for a folder', () => {
    const index: AuthorIndex = {
        identity: IDENTITY,
        authorName: 'Frodo',
        folder: { id: FOLDER, name: 'Blog' },
        notes: [{ noteId: id(2), title: 'Second', indexable: true, published: '2026-01-02T00:00:00.000Z' }],
    };

    it('should title the page with the folder and name the author as the site', () => {
        const html = buildAuthorIndexHtml(index, ORIGIN);
        expect(html).toContain('<title>Blog · Journal</title>');
        expect(html).toContain('<h1 class="serif">Blog</h1>');
        expect(html).toContain('property="og:title" content="Blog"');
        expect(html).toContain('property="og:site_name" content="Frodo"');
        expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/share/${IDENTITY}/f/${FOLDER}" />`);
        expect(html).toContain(`property="og:url" content="${ORIGIN}/share/${IDENTITY}/f/${FOLDER}"`);
        expect(html).toContain(`<a href="${ORIGIN}/share/${IDENTITY}/${id(2)}">Second</a>`);
        expect(html).toContain('<time datetime="2026-01-02T00:00:00.000Z">January 2, 2026</time>');
        expect(html).not.toContain('<script');
    });

    it('should escape the folder name', () => {
        const html = buildAuthorIndexHtml({ ...index, folder: { id: FOLDER, name: '<img src=x onerror=alert(1)>' } }, ORIGIN);
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
});

describe('folder page in the share Pages Function', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function context(path: string) {
        const assets = vi.fn(async () => new Response('<div id="root"></div>'));
        const ctx: ShareContext = {
            request: new Request(`${ORIGIN}${path}`),
            env: { ASSETS: { fetch: assets } },
            waitUntil: () => undefined,
            next: async () => new Response('next'),
        };
        return { ctx, assets };
    }

    it('should serve the folder page as HTML without the SPA shell', async () => {
        vi.stubGlobal('fetch', mockFetch().impl);
        const { ctx, assets } = context(`/share/${IDENTITY}/f/${FOLDER}`);
        const res = await onRequest(ctx);
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(html).toContain('<h1 class="serif">Blog</h1>');
        for (const n of [1, 2, 3]) expect(html).toContain(`/share/${IDENTITY}/${id(n)}`);
        expect(html).not.toContain('id="root"');
        expect(assets).not.toHaveBeenCalled();
    });

    it.each([
        ['an unshared folder', { folder: { status: 404 } }],
        ['an upstream failure', { notes: { status: 500 } }],
    ])('should 404 on %s', async (_, responses) => {
        vi.stubGlobal('fetch', mockFetch(responses).impl);
        const res = await onRequest(context(`/share/${IDENTITY}/f/${FOLDER}`).ctx);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain('id="root"');
    });

    it.each([`/share/${IDENTITY}/f/not-a-guid`, `/share/localhost/f/${FOLDER}`])(
        'should 404 on %s without fetching',
        async (path) => {
            const fetchSpy = vi.fn();
            vi.stubGlobal('fetch', fetchSpy);
            expect((await onRequest(context(path).ctx)).status).toBe(404);
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );

    it('should cache a folder page apart from the author index, for 30 seconds', async () => {
        const puts: Array<{ key: string; cacheControl: string | null }> = [];
        vi.stubGlobal('caches', {
            default: {
                match: async () => undefined,
                put: async (req: Request, res: Response) => void puts.push({ key: req.url, cacheControl: res.headers.get('cache-control') }),
            },
        });
        vi.stubGlobal('fetch', mockFetch().impl);
        await onRequest(context(`/share/${IDENTITY}/f/${FOLDER}`).ctx);
        expect(puts).toEqual([{ key: `https://share-index.invalid/${IDENTITY}/f/${FOLDER}`, cacheControl: 'max-age=30' }]);
    });

    it('should drop a note from the page once it is no longer in the folder', async () => {
        vi.stubGlobal('fetch', mockFetch().impl);
        const before = await (await onRequest(context(`/share/${IDENTITY}/f/${FOLDER}`).ctx)).text();
        expect(before).toContain(id(2));

        const moved = { searchResults: [note(1), note(3)] };
        vi.stubGlobal('fetch', mockFetch({ notes: { status: 200, body: moved } }).impl);
        const after = await (await onRequest(context(`/share/${IDENTITY}/f/${FOLDER}`).ctx)).text();
        expect(after).not.toContain(id(2));
        expect(after).toContain(id(1));
        expect(after).toContain(id(3));
    });
});
