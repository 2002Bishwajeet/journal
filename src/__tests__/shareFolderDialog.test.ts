/** #631: shared folder description, and parallel (max 4) bulk share. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { runLimited } from '@/hooks/useFolderSharing';
import { folderShareDescription } from '../../functions/_lib/folderShare';
import { buildAuthorIndexHtml } from '../../functions/_lib/authorIndex';

describe('folderShareDescription', () => {
    it('is the text the folder page serves as og:description', () => {
        const html = buildAuthorIndexHtml(
            { identity: 'a.example', authorName: 'Ann', notes: [], folder: { id: 'f'.repeat(8), name: 'Blog' } },
            'https://app.test'
        );
        const description = folderShareDescription('Blog', 'Ann');
        expect(html).toContain(`<meta property="og:description" content="${description}" />`);
        expect(html).toContain('<meta property="og:title" content="Blog" />');
    });
});

describe('runLimited', () => {
    it('runs 12 items at most 4 at once, counts failures and reports each finish', async () => {
        let active = 0;
        let peak = 0;
        const progress: number[] = [];
        const failed = await runLimited(
            Array.from({ length: 12 }, (_, i) => i),
            4,
            async (i) => {
                active++;
                peak = Math.max(peak, active);
                await new Promise((r) => setTimeout(r, 5));
                active--;
                if (i % 5 === 0) throw new Error('nope');
            },
            (n) => progress.push(n)
        );
        expect(peak).toBe(4);
        expect(failed).toBe(3);
        expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it('handles an empty list', async () => {
        expect(await runLimited([], 4, async () => {}, () => {})).toBe(0);
    });
});
