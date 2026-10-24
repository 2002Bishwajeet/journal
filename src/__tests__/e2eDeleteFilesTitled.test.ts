/**
 * #742: the live teardown's deleteFilesTitled hook deletes only the notes and
 * collaboration invites whose title matches, across every page of the query.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { COLLABORATION_INVITE_FILE_TYPE, JOURNAL_FILE_TYPE } from '@/lib/homebase/config';

const { mockQueryBatch, mockDeleteFile } = vi.hoisted(() => ({ mockQueryBatch: vi.fn(), mockDeleteFile: vi.fn() }));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        queryBatch: mockQueryBatch,
        deleteFile: mockDeleteFile,
        // The test files carry their decrypted content directly.
        getContentFromHeaderOrPayload: async (_client: unknown, _drive: unknown, file: { content: unknown }) => file.content,
    };
});
vi.mock('@homebase-id/js-lib/auth', () => ({ retrieveIdentity: () => 'owner.test' }));

let deleteFilesTitled: (pattern: string) => Promise<string[]>;
beforeAll(async () => {
    // Node has neither; the hooks module reads location on import, and the client its secrets.
    vi.stubGlobal('location', { origin: 'http://localhost' });
    vi.stubGlobal('localStorage', { getItem: () => 'AAAA' });
    ({ deleteFilesTitled } = await import('@/lib/e2e/testHooks'));
});

const file = (fileId: string, content: object) => ({ fileId, content });

describe('deleteFilesTitled', () => {
    it('deletes matching notes and invites on every page, and nothing else', async () => {
        const firstPage = Array.from({ length: 100 }, (_, i) => file(`keep-${i}`, { title: `Groceries ${i}` }));
        firstPage[3] = file('note', { title: 'Circle share 123' });
        mockQueryBatch
            .mockResolvedValueOnce({ searchResults: firstPage, cursorState: 'next' })
            .mockResolvedValueOnce({
                searchResults: [
                    file('invite', { noteTitle: 'Circle share 123' }),
                    file('prefixed', { title: 'My Circle share 123' }),
                    file('untitled', {}),
                ],
                cursorState: '',
            });

        expect(await deleteFilesTitled('^Circle share \\d+$')).toEqual(['Circle share 123', 'Circle share 123']);

        expect(mockDeleteFile.mock.calls.map(([, , fileId]) => fileId)).toEqual(['note', 'invite']);
        expect(mockQueryBatch).toHaveBeenCalledTimes(2);
        expect(mockQueryBatch.mock.calls[0][1].fileType).toEqual([JOURNAL_FILE_TYPE, COLLABORATION_INVITE_FILE_TYPE]);
        expect(mockQueryBatch.mock.calls[1][2].cursorState).toBe('next');
    });
});
