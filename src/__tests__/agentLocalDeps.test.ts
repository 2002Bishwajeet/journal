/**
 * createLocalDeps (#697): the shared read tools over the real PGlite schema.
 * Notes are seeded through upsertSearchIndex + saveDocumentUpdate, as the app stores them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { upsertSearchIndex, saveDocumentUpdate, createFolder } from '@/lib/db/queries';
import { createLocalDeps } from '@/lib/agent/local/localDeps';
import { TOOLS } from '@/lib/agent/tools/registry';
import { appendMarkdown, toMarkdown } from '@/lib/agent/editEngine';

const F1 = '10000000-0000-0000-0000-000000000001';
const F2 = '10000000-0000-0000-0000-000000000002';
const NORMAL_A = '30000000-0000-0000-0000-000000000001';
const NORMAL_B = '30000000-0000-0000-0000-000000000002';
const EXCLUDED = '30000000-0000-0000-0000-000000000003';
const TRASHED = '30000000-0000-0000-0000-000000000004';

const bodyDoc = (markdown: string) => {
    const doc = new Y.Doc();
    appendMarkdown(doc, markdown);
    return doc;
};

async function addNote(
    docId: string,
    title: string,
    body: string,
    folderId: string,
    extra: { excludeFromAI?: boolean; archivalStatus?: number } = {}
) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent: body,
        metadata: {
            title,
            folderId,
            timestamps: { created: now, modified: now },
            excludeFromAI: extra.excludeFromAI ?? false,
            archivalStatus: extra.archivalStatus,
        },
    });
    await saveDocumentUpdate(docId, Y.encodeStateAsUpdate(bodyDoc(body)));
}

const run = (name: string, input: object) => {
    const tool = TOOLS.find((t) => t.name === name)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return tool.execute(createLocalDeps() as Parameters<typeof tool.execute>[0], tool.input.parse(input)) as Promise<{ data: any }>;
};

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    await createFolder(F1, 'One');
    await createFolder(F2, 'Two');
    await addNote(NORMAL_A, 'Garden plan', 'Planting zucchini along the south fence.', F1);
    await addNote(NORMAL_B, 'Reading list', 'Finish the novel about lighthouses.', F2);
    await addNote(EXCLUDED, 'Private diary', 'Secret zucchini recipe.', F1, { excludeFromAI: true });
    await addNote(TRASHED, 'Old draft', 'Discarded zucchini thoughts.', F2, { archivalStatus: 2 });
});

describe('createLocalDeps through the registry tools', () => {
    it('list_notes returns only the two normal notes', async () => {
        const { data } = await run('list_notes', {});
        expect(data.map((n: { id: string }) => n.id).sort()).toEqual([NORMAL_A, NORMAL_B].sort());
    });

    it('get_note fails with "Note not found" for an excludeFromAI note', async () => {
        await expect(run('get_note', { id: EXCLUDED })).rejects.toThrow('Note not found');
    });

    it('get_note fails for a trashed note', async () => {
        await expect(run('get_note', { id: TRASHED })).rejects.toThrow('Note not found');
    });

    it('get_note markdown equals toMarkdown of the stored doc', async () => {
        const { data } = await run('get_note', { id: NORMAL_A });
        expect(data.markdown).toBe(toMarkdown(bodyDoc('Planting zucchini along the south fence.')));
    });

    it('search_notes ranks the match first with a snippet, never excluded or trashed notes', async () => {
        const { data } = await run('search_notes', { query: 'zucchini' });
        expect(data.map((n: { id: string }) => n.id)).toEqual([NORMAL_A]);
        expect(data[0].snippet).toContain('zucchini');
        expect(data[0].snippet).not.toContain('<mark>');
    });
});
