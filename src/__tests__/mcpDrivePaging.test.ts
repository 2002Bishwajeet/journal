import { describe, it, expect, vi } from 'vitest';
import type { HomebaseFile } from '@homebase-id/js-lib/core';
import { collectPages, toNoteSummary } from '../../mcp/drive';
import type { NoteFileContent } from '@/types';

describe('collectPages', () => {
    it('stops at the first empty page even though Homebase keeps returning a cursor', async () => {
        // Homebase's queryBatch never returns an empty cursorState: past the last result it
        // hands back an empty page with the same cursor, forever.
        const fetchPage = vi.fn(async (cursor: string | undefined) =>
            cursor ? { items: [], cursor } : { items: ['a', null, 'b'], cursor: 'end' }
        );

        await expect(collectPages(fetchPage)).resolves.toEqual(['a', 'b']);
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it('follows the cursor across non-empty pages', async () => {
        const pages: Record<string, { items: string[]; cursor: string }> = {
            start: { items: ['a'], cursor: 'p2' },
            p2: { items: ['b'], cursor: 'p3' },
            p3: { items: [], cursor: 'p3' },
        };
        await expect(collectPages(async (cursor) => pages[cursor ?? 'start'])).resolves.toEqual(['a', 'b']);
    });
});

describe('toNoteSummary (#511)', () => {
    const file = (archivalStatus: number) =>
        ({
            fileMetadata: {
                updated: 0,
                appData: { uniqueId: 'n1', groupId: 'F1', archivalStatus, content: { title: 'T', tags: [] } },
            },
        }) as unknown as HomebaseFile<NoteFileContent>;

    it('hides a note in Trash from agents, but not an active or archived one', () => {
        expect(toNoteSummary(file(2))).toBeNull();
        expect(toNoteSummary(file(0))).toMatchObject({ id: 'n1', title: 'T', folderId: 'F1' });
        expect(toNoteSummary(file(1))).not.toBeNull();
    });
});
