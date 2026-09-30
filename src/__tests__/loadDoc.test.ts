import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { ydocFromUpdates, loadLocalYDoc } from '@/lib/yjs';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('ydocFromUpdates', () => {
    it('should yield the same prosemirror content as applying the updates by hand', () => {
        const source = new Y.Doc();
        const updates: Uint8Array[] = [];
        source.on('update', (u: Uint8Array) => updates.push(u));
        const fragment = source.getXmlFragment('prosemirror');
        const heading = new Y.XmlElement('heading');
        heading.push([new Y.XmlText('Title')]);
        fragment.push([heading]);
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.push([new Y.XmlText('body text')]);
        fragment.push([paragraph]);
        expect(updates).toHaveLength(2);

        const byHand = new Y.Doc();
        for (const u of updates) Y.applyUpdate(byHand, u);

        const loaded = ydocFromUpdates(updates);
        expect(loaded.getXmlFragment('prosemirror').toString()).toBe(
            byHand.getXmlFragment('prosemirror').toString(),
        );
    });
});

describe('loadLocalYDoc', () => {
    it('should return null for a doc id with no stored updates', async () => {
        expect(await loadLocalYDoc('30000000-0000-0000-0000-000000000001')).toBeNull();
    });
});
