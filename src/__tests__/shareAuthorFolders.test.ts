/**
 * #632: the author page /share/<identity> lists the author's shared folders with
 * their notes, then the notes shared one by one; the sitemap lists the folder pages.
 */
import { describe, expect, it, vi } from 'vitest';
import { FOLDER_FILE_TYPE as APP_FOLDER_FILE_TYPE } from '@/lib/homebase/config';
import {
    FOLDER_FILE_TYPE,
    buildAuthorIndexHtml,
    buildSitemapXml,
    fetchAuthorIndex,
    groupNotesByFolder,
    type AuthorIndex,
} from '../../functions/_lib/authorIndex';

const IDENTITY = 'frodo.dotyou.cloud';
const ORIGIN = 'https://journal.test';
const id = (n: number) => `11111111-1111-1111-1111-${String(n).padStart(12, '0')}`;
const fid = (n: number) => `33333333-3333-3333-3333-${String(n).padStart(12, '0')}`;

const note = (n: number, groupId?: string) => ({
    noteId: id(n),
    title: `Note ${n}`,
    indexable: true,
    published: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
    ...(groupId ? { groupId } : {}),
});

function index(overrides: Partial<AuthorIndex> = {}): AuthorIndex {
    return { identity: IDENTITY, authorName: 'Frodo', notes: [note(1)], ...overrides };
}

function noteFile(n: number, groupId: string) {
    return {
        fileMetadata: {
            created: Date.UTC(2026, 0, n),
            updated: Date.UTC(2026, 0, n),
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

function folderFile(n: number, content: unknown, extra: object = {}) {
    return {
        fileMetadata: {
            isEncrypted: false,
            appData: { uniqueId: fid(n), archivalStatus: 0, content: JSON.stringify(content), ...extra },
        },
    };
}

function fetchWith(folderRes: { status: number; body?: unknown }) {
    const notes = [noteFile(3, fid(1)), noteFile(2, fid(1)), noteFile(1, fid(7))];
    return vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const res = url.includes('/pub/profile')
            ? { status: 200, body: { name: 'Frodo' } }
            : url.includes(`fileType=${FOLDER_FILE_TYPE}`)
              ? folderRes
              : { status: 200, body: { searchResults: notes } };
        return new Response(JSON.stringify(res.body ?? {}), { status: res.status });
    }) as unknown as typeof fetch;
}

describe('shared folders on the author page (#632)', () => {
    it('should match the app folder file type', () => {
        expect(FOLDER_FILE_TYPE).toBe(APP_FOLDER_FILE_TYPE);
    });

    it('should group notes under their shared folder and leave the rest, keeping order', () => {
        const { folders, rest } = groupNotesByFolder(
            [note(5, fid(1)), note(4), note(3, fid(1)), note(2, fid(9)), note(1, fid(2))],
            [
                { id: fid(1), name: 'Blog' },
                { id: fid(2), name: 'Empty' },
                { id: fid(3), name: 'Nothing' },
            ],
        );
        expect(folders.map((f) => [f.name, f.notes.map((n) => n.noteId)])).toEqual([
            ['Blog', [id(5), id(3)]],
            ['Empty', [id(1)]],
        ]);
        expect(rest.map((n) => n.noteId)).toEqual([id(4), id(2)]);
    });

    it('should keep only shared, named, unencrypted, active folders and group the notes', async () => {
        const impl = fetchWith({
            status: 200,
            body: {
                searchResults: [
                    folderFile(1, { name: 'Blog', isPublic: true }),
                    folderFile(2, { name: 'Private', isPublic: false }),
                    folderFile(3, { name: 'Trashed', isPublic: true }, { archivalStatus: 2 }),
                    folderFile(4, { isPublic: true }),
                ],
            },
        });
        const result = await fetchAuthorIndex(IDENTITY, impl);
        expect(result?.folders?.map((f) => [f.id, f.name, f.notes.map((n) => n.noteId)])).toEqual([
            [fid(1), 'Blog', [id(3), id(2)]],
        ]);
        expect(result?.notes.map((n) => n.noteId)).toEqual([id(1)]);
    });

    it('should fall back to the flat list when the folder query fails', async () => {
        const result = await fetchAuthorIndex(IDENTITY, fetchWith({ status: 500 }));
        expect(result?.folders).toBeUndefined();
        expect(result?.notes).toHaveLength(3);
    });

    it('should render Folders then Notes, cap a folder at 5 notes and link to its page', () => {
        const many = [9, 8, 7, 6, 5, 4, 3].map((n) => note(n, fid(1)));
        const html = buildAuthorIndexHtml(
            index({ folders: [{ id: fid(1), name: 'Blog <1>', notes: many }] }),
            ORIGIN,
        );
        const folderUrl = `${ORIGIN}/share/${IDENTITY}/f/${fid(1)}`;
        expect(html).toContain(`<h3><a href="${folderUrl}">Blog &lt;1&gt;</a></h3>`);
        expect(html).toContain(`<a href="${folderUrl}">All 7 notes →</a>`);
        expect(html.match(/<li>/g)).toHaveLength(6);
        expect(html.indexOf('Folders')).toBeLessThan(html.indexOf('Blog'));
        expect(html.indexOf('Blog')).toBeLessThan(html.indexOf('>Notes<'));
    });

    it('should leave out the Notes section when every note is in a folder, and not cap small folders', () => {
        const html = buildAuthorIndexHtml(
            index({ notes: [], folders: [{ id: fid(1), name: 'Blog', notes: [note(2, fid(1)), note(1, fid(1))] }] }),
            ORIGIN,
        );
        expect(html).not.toContain('>Notes<');
        expect(html).not.toContain('All ');
    });

    it('should list the folder page in the sitemap', () => {
        const xml = buildSitemapXml(index({ notes: [], folders: [{ id: fid(1), name: 'Blog', notes: [note(2, fid(1))] }] }), ORIGIN);
        expect(xml).toContain(`<loc>${ORIGIN}/share/${IDENTITY}/f/${fid(1)}</loc>`);
    });
});
