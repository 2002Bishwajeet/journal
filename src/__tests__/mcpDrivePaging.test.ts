import { describe, it, expect, vi } from 'vitest';
import { collectPages } from '../../mcp/drive';

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
