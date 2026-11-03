/** #644: a shared folder's link card: when it is redrawn, and the head the folder page serves. */
import { describe, expect, it } from 'vitest';
import { folderCardExcerpt, sameFolderCardFrom } from '@/lib/share/folderCard';
import { buildAuthorIndexHtml, fetchAuthorIndex, type AuthorIndex } from '../../functions/_lib/authorIndex';

const IDENTITY = 'frodo.dotyou.cloud';
const ORIGIN = 'https://journal.test';
const FOLDER = '33333333-3333-3333-3333-000000000001';
const FILE = 'bbbbbbbb-0000-0000-0000-000000000001';

describe('sameFolderCardFrom', () => {
    it('should need a redraw when there is no card yet, or the name or count changed', () => {
        const from = { name: 'Blog', count: 3 };
        expect(sameFolderCardFrom(undefined, from)).toBe(false);
        expect(sameFolderCardFrom({ name: 'Blog', count: 2 }, from)).toBe(false);
        expect(sameFolderCardFrom({ name: 'Posts', count: 3 }, from)).toBe(false);
        expect(sameFolderCardFrom({ name: 'Blog', count: 3 }, from)).toBe(true);
    });

    it('should word the count', () => {
        expect(folderCardExcerpt(1)).toBe('1 note');
        expect(folderCardExcerpt(3)).toBe('3 notes');
    });
});

const index = (cardImage?: { fileId: string; version?: number }): AuthorIndex => ({
    identity: IDENTITY,
    authorName: 'Frodo',
    notes: [],
    folder: { id: FOLDER, name: 'Blog', ...(cardImage ? { cardImage } : {}) },
});

describe('the folder page head', () => {
    it('should serve the folder card as a large og:image', () => {
        const html = buildAuthorIndexHtml(index({ fileId: FILE, version: 42 }), ORIGIN);
        const url = new URL(/property="og:image" content="([^"]+)"/.exec(html)![1].replace(/&amp;/g, '&'));
        expect(url.origin).toBe(`https://${IDENTITY}`);
        expect(url.pathname).toBe('/api/guest/v1/drive/files/payload');
        expect(url.searchParams.get('fileId')).toBe(FILE);
        expect(url.searchParams.get('key')).toBe('jrnl_card');
        expect(url.searchParams.get('v')).toBe('42');
        expect(html).toContain('property="og:image:width" content="1200"');
        expect(html).toContain('property="og:image:height" content="630"');
        expect(html).toContain('name="twitter:card" content="summary_large_image"');
    });

    it('should keep the banner and summary for a folder without a card', () => {
        const html = buildAuthorIndexHtml(index(), ORIGIN);
        expect(html).toContain(`property="og:image" content="${ORIGIN}/banner.webp"`);
        expect(html).toContain('name="twitter:card" content="summary"');
        expect(html).not.toContain('og:image:width');
    });

    it('should keep the banner on the author page', () => {
        const html = buildAuthorIndexHtml({ identity: IDENTITY, authorName: 'Frodo', notes: [] }, ORIGIN);
        expect(html).toContain(`property="og:image" content="${ORIGIN}/banner.webp"`);
        expect(html).toContain('name="twitter:card" content="summary"');
    });
});

describe('fetchAuthorIndex card detection', () => {
    const fetchWith = (content: unknown, payloads: { key: string }[]) =>
        (async (input: RequestInfo | URL) => {
            const url = String(input);
            const body = url.includes('/pub/profile')
                ? { name: 'Frodo' }
                : url.includes('/cuid/header')
                  ? { fileId: FILE, fileMetadata: { isEncrypted: false, updated: 7, payloads, appData: { content: JSON.stringify(content) } } }
                  : { searchResults: [] };
            return new Response(JSON.stringify(body), { status: 200 });
        }) as unknown as typeof fetch;
    const named = { name: 'Blog', isPublic: true, card: { cardImageKey: 'jrnl_card', from: { name: 'Blog', count: 1 } } };

    it('should expose the card when the content names it and the payload exists', async () => {
        const result = await fetchAuthorIndex(IDENTITY, fetchWith(named, [{ key: 'jrnl_card' }]), undefined, FOLDER);
        expect(result?.folder?.cardImage).toEqual({ fileId: FILE, version: 7 });
    });

    it.each([
        ['the payload is missing', named, []],
        ['the content names no card', { name: 'Blog', isPublic: true }, [{ key: 'jrnl_card' }]],
    ])('should expose no card when %s', async (_why, content, payloads) => {
        const result = await fetchAuthorIndex(IDENTITY, fetchWith(content, payloads), undefined, FOLDER);
        expect(result?.folder).toEqual({ id: FOLDER, name: 'Blog' });
    });
});
