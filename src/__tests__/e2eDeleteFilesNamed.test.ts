/**
 * #742: the live teardown's deleteFilesNamed hook deletes, on the server, only the
 * folders (with their notes), notes and invites whose name matches, across every
 * page of the query.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { COLLABORATION_INVITE_FILE_TYPE, FOLDER_FILE_TYPE, JOURNAL_FILE_TYPE } from '@/lib/homebase/config';

const { mockQueryBatch, mockDeleteFile, mockDeleteByGroup } = vi.hoisted(() => ({
    mockQueryBatch: vi.fn(),
    mockDeleteFile: vi.fn(),
    mockDeleteByGroup: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        queryBatch: mockQueryBatch,
        deleteFile: mockDeleteFile,
        deleteFilesByGroupId: mockDeleteByGroup,
        // The test files carry their decrypted content directly.
        getContentFromHeaderOrPayload: async (_client: unknown, _drive: unknown, file: { content: unknown }) => file.content,
    };
});
vi.mock('@homebase-id/js-lib/auth', () => ({ retrieveIdentity: () => 'owner.test' }));

let deleteFilesNamed: (pattern: string) => Promise<string[]>;
beforeAll(async () => {
    // Node has neither; the hooks module reads location on import, and the client its secrets.
    vi.stubGlobal('location', { origin: 'http://localhost' });
    vi.stubGlobal('localStorage', { getItem: () => 'AAAA' });
    ({ deleteFilesNamed } = await import('@/lib/e2e/testHooks'));
});

const file = (fileId: string, fileType: number, content: object, uniqueId = `${fileId}-unique`) =>
    ({ fileId, content, fileMetadata: { appData: { fileType, uniqueId } } });

describe('deleteFilesNamed', () => {
    it('deletes matching folders, notes and invites on every page, folders last, and nothing else', async () => {
        const firstPage = Array.from({ length: 100 }, (_, i) => file(`keep-${i}`, JOURNAL_FILE_TYPE, { title: `Groceries ${i}` }));
        firstPage[2] = file('folder', FOLDER_FILE_TYPE, { name: 'e2e-run-w0' }, 'folder-unique');
        firstPage[3] = file('note', JOURNAL_FILE_TYPE, { title: 'Circle share 123' });
        mockQueryBatch
            .mockResolvedValueOnce({ searchResults: firstPage, cursorState: 'next' })
            .mockResolvedValueOnce({
                searchResults: [
                    file('invite', COLLABORATION_INVITE_FILE_TYPE, { noteTitle: 'Circle share 123' }),
                    file('prefixed', JOURNAL_FILE_TYPE, { title: 'My Circle share 123' }),
                    file('other-folder', FOLDER_FILE_TYPE, { name: 'Work' }),
                    file('untitled', JOURNAL_FILE_TYPE, {}),
                ],
                cursorState: '',
            });

        expect(await deleteFilesNamed('^(e2e-run-w\\d+|Circle share \\d+)$')).toEqual(['Circle share 123', 'Circle share 123', 'e2e-run-w0']);

        expect(mockDeleteFile.mock.calls.map(([, , fileId]) => fileId)).toEqual(['note', 'invite', 'folder']);
        expect(mockDeleteByGroup).toHaveBeenCalledTimes(1);
        expect(mockDeleteByGroup.mock.calls[0][2]).toEqual(['folder-unique']);
        expect(mockQueryBatch).toHaveBeenCalledTimes(2);
        expect(mockQueryBatch.mock.calls[0][1].fileType).toEqual([JOURNAL_FILE_TYPE, FOLDER_FILE_TYPE, COLLABORATION_INVITE_FILE_TYPE]);
        expect(mockQueryBatch.mock.calls[1][2].cursorState).toBe('next');
    });
});
