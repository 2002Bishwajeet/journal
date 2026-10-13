// @vitest-environment happy-dom
/** #618: notes imported into a shared folder start public, like any note created there. */
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import type { SearchIndexEntry } from '@/types';

const { upsertSearchIndex } = vi.hoisted(() => ({ upsertSearchIndex: vi.fn<(entry: SearchIndexEntry) => Promise<void>>() }));
vi.mock('@/lib/db/queries', () => ({
    getAllFolders: vi.fn().mockResolvedValue([
        { id: 'shared-folder', name: 'Blog', createdAt: new Date(), isPublic: true },
        { id: 'private-folder', name: 'Diary', createdAt: new Date(), isPublic: false },
    ]),
    upsertSyncRecord: vi.fn(),
    saveDocumentUpdate: vi.fn(),
    upsertSearchIndex,
    createFolder: vi.fn(),
}));

import { ImportService } from '@/lib/importexport/ImportService';

describe('importing into a shared folder', () => {
    it('makes the notes imported into the shared folder public and leaves the others private', async () => {
        const zip = new JSZip();
        zip.file('Blog/post.md', '# Post');
        zip.file('Diary/entry.md', '# Entry');
        zip.file('New folder/other.md', '# Other');
        const file = new File([await zip.generateAsync({ type: 'blob' })], 'export.zip');

        const result = await ImportService.importFiles([file]);
        expect(result.imported).toBe(3);

        const byTitle = new Map(upsertSearchIndex.mock.calls.map(([entry]) => [entry.title, entry.metadata]));
        expect(byTitle.get('post')).toMatchObject({ folderId: 'shared-folder', isPublic: true, shareIndexable: true });
        expect(byTitle.get('entry')).toMatchObject({ folderId: 'private-folder' });
        expect(byTitle.get('entry')?.isPublic).toBeUndefined();
        expect(byTitle.get('other')?.isPublic).toBeUndefined();
    });
});
