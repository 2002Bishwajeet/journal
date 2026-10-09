/**
 * The /share/* Pages Function serves the SPA shell with the shared note's own
 * link-preview meta (og/twitter/JSON-LD), and the plain shell on any failure.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOURNAL_DRIVE, PAYLOAD_KEY_CARD_IMAGE } from '@/lib/homebase/config';
import {
    CARD_IMAGE_KEY,
    JOURNAL_DRIVE_ALIAS,
    JOURNAL_DRIVE_TYPE,
    buildHeadTags,
    fallbackShareDescription,
    fetchShareMeta,
    injectShareMeta,
    parseSharePath,
    type ShareMeta,
} from '../../functions/_lib/shareMeta';
import { onRequest } from '../../functions/share/[[path]]';
import type { ShareContext } from '../../functions/_lib/types';

const GUID = '11111111-1111-1111-1111-111111111111';
const IDENTITY = 'frodo.dotyou.cloud';
const INDEX_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function headerJson(overrides: {
    content?: unknown;
    payloads?: Array<{ key: string }>;
    isEncrypted?: boolean;
    archivalStatus?: number;
} = {}) {
    return {
        fileId: 'aaaaaaaa-0000-0000-0000-000000000001',
        fileMetadata: {
            created: Date.UTC(2026, 0, 2),
            updated: Date.UTC(2026, 0, 3),
            isEncrypted: overrides.isEncrypted ?? false,
            appData: {
                content: overrides.content ?? JSON.stringify({ title: 'T' }),
                archivalStatus: overrides.archivalStatus ?? 0,
            },
            payloads: overrides.payloads ?? [],
        },
    };
}

/** A fetch mock that answers the header and profile endpoints and records URLs. */
function mockFetch(
    header: { status: number; body?: unknown },
    profile: { status: number; body?: unknown } = { status: 200, body: { name: 'Frodo' } },
) {
    const urls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        const res = url.includes('/pub/profile') ? profile : header;
        return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status });
    });
    return { impl: impl as unknown as typeof fetch, urls };
}

function meta(overrides: Partial<ShareMeta> = {}): ShareMeta {
    return {
        identity: IDENTITY,
        noteId: GUID,
        fileId: 'file-1',
        title: 'T',
        indexable: false,
        authorName: 'Frodo',
        ...overrides,
    };
}

describe('share meta constants', () => {
    it('should match the app drive', () => {
        expect(JOURNAL_DRIVE_ALIAS).toBe(JOURNAL_DRIVE.alias);
        expect(JOURNAL_DRIVE_TYPE).toBe(JOURNAL_DRIVE.type);
    });

    it('should match the app card image key', () => {
        expect(CARD_IMAGE_KEY).toBe(PAYLOAD_KEY_CARD_IMAGE);
    });
});

describe('parseSharePath', () => {
    it('should accept an identity and a note guid, with or without a trailing slash', () => {
        expect(parseSharePath(`/share/frodo.dotyou.cloud/${GUID}`)).toEqual({ identity: IDENTITY, noteId: GUID });
        expect(parseSharePath(`/share/frodo.dotyou.cloud/${GUID}/`)).toEqual({ identity: IDENTITY, noteId: GUID });
    });

    it.each([
        `/share/127.0.0.1/${GUID}`,
        `/share/localhost/${GUID}`,
        `/share/a.b:8080/${GUID}`,
        `/share/user@a.b/${GUID}`,
        '/share/a.b/not-a-guid',
        `/share/a.b/${GUID}/extra`,
        '/share-target',
    ])('should reject %s', (path) => {
        expect(parseSharePath(path)).toBeNull();
    });
});

describe('fetchShareMeta', () => {
    it('should read the title, card description and cover key', async () => {
        const { impl } = mockFetch({
            status: 200,
            body: headerJson({
                content: JSON.stringify({ title: 'T', card: { description: 'D', coverKey: 'jrnl_img2' } }),
                payloads: [{ key: 'jrnl_img2' }],
            }),
        });
        const result = await fetchShareMeta(IDENTITY, GUID, impl);
        expect(result).toMatchObject({ title: 'T', description: 'D', coverKey: 'jrnl_img2', authorName: 'Frodo' });
        expect(result?.indexable).toBe(false);
    });

    it('should drop a cover key that is not one of the payloads', async () => {
        const { impl } = mockFetch({
            status: 200,
            body: headerJson({ content: JSON.stringify({ title: 'T', card: { coverKey: 'jrnl_img2' } }) }),
        });
        expect((await fetchShareMeta(IDENTITY, GUID, impl))?.coverKey).toBeUndefined();
    });

    it('should read the card image key when it is the card key and one of the payloads', async () => {
        const { impl } = mockFetch({
            status: 200,
            body: headerJson({
                content: JSON.stringify({ title: 'T', card: { coverKey: 'jrnl_img2', cardImageKey: 'jrnl_card' } }),
                payloads: [{ key: 'jrnl_img2' }, { key: 'jrnl_card' }],
            }),
        });
        expect(await fetchShareMeta(IDENTITY, GUID, impl)).toMatchObject({ coverKey: 'jrnl_img2', cardImageKey: 'jrnl_card' });
    });

    it.each([
        ['an image key', 'jrnl_img0'],
        ['the content key', 'jrnl_txt'],
        ['an arbitrary string', 'jrnl_card&x=1'],
        ['a near miss', 'jrnl_card0'],
        ['a non-string', 42],
    ])('should drop a card image key that is %s', async (_label, cardImageKey) => {
        const { impl } = mockFetch({
            status: 200,
            body: headerJson({
                content: JSON.stringify({ title: 'T', card: { cardImageKey } }),
                payloads: [{ key: 'jrnl_img0' }, { key: 'jrnl_txt' }, { key: 'jrnl_card' }, { key: 'jrnl_card0' }],
            }),
        });
        expect((await fetchShareMeta(IDENTITY, GUID, impl))?.cardImageKey).toBeUndefined();
    });

    it('should drop a card image key that is not one of the payloads', async () => {
        const { impl } = mockFetch({
            status: 200,
            body: headerJson({
                content: JSON.stringify({ title: 'T', card: { coverKey: 'jrnl_img2', cardImageKey: 'jrnl_card' } }),
                payloads: [{ key: 'jrnl_img2' }],
            }),
        });
        const result = await fetchShareMeta(IDENTITY, GUID, impl);
        expect(result?.cardImageKey).toBeUndefined();
        expect(result?.coverKey).toBe('jrnl_img2');
    });

    it.each([
        ['an encrypted note', { status: 200, body: headerJson({ isEncrypted: true }) }],
        ['a trashed note', { status: 200, body: headerJson({ archivalStatus: 2 }) }],
        ['a 404', { status: 404 }],
        ['a 302', { status: 302 }],
    ])('should return null for %s', async (_label, header) => {
        const { impl } = mockFetch(header);
        expect(await fetchShareMeta(IDENTITY, GUID, impl)).toBeNull();
    });

    it('should fall back to the identity as author when the profile fails', async () => {
        const { impl } = mockFetch({ status: 200, body: headerJson() }, { status: 500 });
        expect((await fetchShareMeta(IDENTITY, GUID, impl))?.authorName).toBe(IDENTITY);
    });

    it('should only fetch from the identity, or the override base when one is passed', async () => {
        const direct = mockFetch({ status: 200, body: headerJson() });
        await fetchShareMeta(IDENTITY, GUID, direct.impl);
        expect(direct.urls).toHaveLength(2);
        expect(direct.urls.every((u) => u.startsWith(`https://${IDENTITY}/`))).toBe(true);

        const overridden = mockFetch({ status: 200, body: headerJson() });
        await fetchShareMeta(IDENTITY, GUID, overridden.impl, 'http://127.0.0.1:8799/');
        expect(overridden.urls).toHaveLength(2);
        expect(overridden.urls.every((u) => u.startsWith('http://127.0.0.1:8799/'))).toBe(true);
    });
});

describe('buildHeadTags', () => {
    const url = 'https://j.test/share/x';
    const ogImage = (tags: string) =>
        /<meta property="og:image" content="([^"]+)"/.exec(tags)?.[1].replace(/&amp;/g, '&') ?? '';

    it('should point og:image at the card image payload, with its 1200×630 size', () => {
        const tags = buildHeadTags(
            meta({ coverKey: 'jrnl_img2', cardImageKey: 'jrnl_card', modified: '2026-01-03T00:00:00.000Z' }),
            url,
            'https://j.test',
        );
        const image = new URL(ogImage(tags));

        expect(image.origin).toBe(`https://${IDENTITY}`);
        expect(image.pathname).toBe('/api/guest/v1/drive/files/payload');
        expect(Object.fromEntries(image.searchParams)).toEqual({
            alias: JOURNAL_DRIVE_ALIAS,
            type: JOURNAL_DRIVE_TYPE,
            fileId: 'file-1',
            key: 'jrnl_card',
            v: String(Date.parse('2026-01-03T00:00:00.000Z')),
        });
        expect(tags).toContain('property="og:image:width" content="1200"');
        expect(tags).toContain('property="og:image:height" content="630"');
        expect(tags).toContain(`name="twitter:image" content="${image.href.replace(/&/g, '&amp;')}"`);
        expect(tags).toContain('name="twitter:card" content="summary_large_image"');
    });

    it('should fall back to the cover thumb, without a size, for a note published before card images', () => {
        const tags = buildHeadTags(meta({ coverKey: 'jrnl_img2' }), url, 'https://j.test');
        const image = new URL(ogImage(tags));

        expect(image.pathname).toBe('/api/guest/v1/drive/files/thumb');
        expect(image.searchParams.get('payloadKey')).toBe('jrnl_img2');
        expect(tags).not.toContain('og:image:width');
        expect(tags).not.toContain('og:image:height');
        expect(tags).toContain('name="twitter:card" content="summary_large_image"');
    });

    it('should change the image URL when the note is modified', () => {
        const a = ogImage(buildHeadTags(meta({ coverKey: 'jrnl_img2', modified: '2026-01-03T00:00:00.000Z' }), url, 'https://j.test'));
        const b = ogImage(buildHeadTags(meta({ coverKey: 'jrnl_img2', modified: '2026-01-04T00:00:00.000Z' }), url, 'https://j.test'));
        expect(a).not.toBe(b);
        expect(new URL(a).searchParams.get('v')).toBe(String(Date.parse('2026-01-03T00:00:00.000Z')));
    });

    it('should fall back to the banner for a note with no card image or cover', () => {
        const tags = buildHeadTags(meta(), url, 'https://j.test');

        expect(ogImage(tags)).toBe('https://j.test/banner.webp');
        expect(tags).not.toContain('og:image:width');
        expect(tags).toContain('name="twitter:card" content="summary_large_image"');
    });

    it('should use the designed card of a note with no cover, as a large image (#434)', () => {
        const tags = buildHeadTags(meta({ cardImageKey: 'jrnl_card' }), url, 'https://j.test');
        const image = new URL(ogImage(tags));

        expect(image.pathname).toBe('/api/guest/v1/drive/files/payload');
        expect(image.searchParams.get('key')).toBe('jrnl_card');
        expect(tags).toContain('property="og:image:width" content="1200"');
        expect(tags).toContain('property="og:image:height" content="630"');
        expect(tags).toContain('name="twitter:card" content="summary_large_image"');
    });

    it('should escape the title', () => {
        const tags = buildHeadTags(meta({ title: '"><script>alert(1)</script>' }), 'https://j.test/share/x', 'https://j.test');
        expect(tags).not.toContain('<script>alert');
    });

    it('should emit noindex unless the note is indexable', () => {
        const url = 'https://j.test/share/x';
        expect(buildHeadTags(meta(), url, 'https://j.test')).toContain('name="robots" content="noindex"');
        expect(buildHeadTags(meta({ indexable: true }), url, 'https://j.test')).not.toContain('noindex');
    });

    it('should use the fallback description when the note has none', () => {
        expect(fallbackShareDescription('Frodo')).toBe('A note by Frodo, shared with Journal');
        const tags = buildHeadTags(meta(), 'https://j.test/share/x', 'https://j.test');
        expect(tags).toContain('name="description" content="A note by Frodo, shared with Journal"');
    });
});

describe('injectShareMeta', () => {
    it('should replace the marker block', () => {
        const html = 'a<!-- share-meta:start --><title>x</title><!-- share-meta:end -->b';
        expect(injectShareMeta(html, '<title>y</title>')).toBe('a<title>y</title>b');
    });

    it('should return the input unchanged without markers', () => {
        expect(injectShareMeta('<title>x</title>', '<title>y</title>')).toBe('<title>x</title>');
    });
});

describe('share Pages Function', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function context(path: string, method = 'GET') {
        const next = vi.fn(async () => new Response('next'));
        const ctx: ShareContext = {
            request: new Request(`https://journal.test${path}`, { method }),
            env: {
                ASSETS: {
                    fetch: async () =>
                        new Response(INDEX_HTML, {
                            headers: {
                                'content-type': 'text/html; charset=utf-8',
                                'cross-origin-embedder-policy': 'require-corp',
                            },
                        }),
                },
            },
            waitUntil: () => undefined,
            next,
        };
        return { ctx, next };
    }

    it('should serve the note meta for a valid public note and keep the COEP header', async () => {
        vi.stubGlobal('fetch', mockFetch({ status: 200, body: headerJson() }).impl);
        const res = await onRequest(context(`/share/${IDENTITY}/${GUID}`).ctx);
        const html = await res.text();

        expect(res.status).toBe(200);
        expect(html.split('property="og:title" content="T"')).toHaveLength(2);
        expect(html).not.toContain('<title>Journal - Effortless Writing</title>');
        expect(html).toContain('id="root"');
        expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    });

    it('should return the shell byte-for-byte for an invalid path', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const res = await onRequest(context(`/share/localhost/${GUID}`).ctx);
        expect(await res.text()).toBe(INDEX_HTML);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should return the shell when the upstream fetch rejects', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
        const res = await onRequest(context(`/share/${IDENTITY}/${GUID}`).ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(INDEX_HTML);
    });

    it('should pass non-GET requests to next()', async () => {
        const { ctx, next } = context(`/share/${IDENTITY}/${GUID}`, 'POST');
        expect(await (await onRequest(ctx)).text()).toBe('next');
        expect(next).toHaveBeenCalledOnce();
    });
});
