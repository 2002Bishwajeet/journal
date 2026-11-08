/**
 * A share link opened by a signed-in viewer whose guest read was refused (#1002):
 * findSharedNotePath opens the note when this Journal has it (the owner's own
 * note, or a peer copy keyed by the owner's uniqueId), pulls from the owner once
 * when it doesn't, and is null ("no access") when the pull brings nothing. Real
 * PGlite; the pull is a stub.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { upsertSearchIndex } from '@/lib/db/queries';
import { findSharedNotePath } from '@/hooks/useOpenSharedNote';
import { COLLABORATIVE_FOLDER_ID } from '@/lib/homebase/config';

const FILE = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';

const addNote = (folderId: string) =>
    upsertSearchIndex({
        docId: FILE,
        title: 'Shared plan',
        plainTextContent: '',
        metadata: {
            title: 'Shared plan',
            folderId,
            timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
            excludeFromAI: false,
        },
    });

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

describe('findSharedNotePath', () => {
    it('opens a note this Journal already has, without pulling', async () => {
        await addNote(COLLABORATIVE_FOLDER_ID);
        const pull = vi.fn(async () => {});

        expect(await findSharedNotePath(FILE, pull)).toBe(`/${COLLABORATIVE_FOLDER_ID}/${FILE}`);
        expect(pull).not.toHaveBeenCalled();
    });

    it('pulls from the owner once when the note is not here yet, then opens it', async () => {
        const pull = vi.fn(() => addNote(COLLABORATIVE_FOLDER_ID));

        expect(await findSharedNotePath(FILE, pull)).toBe(`/${COLLABORATIVE_FOLDER_ID}/${FILE}`);
        expect(pull).toHaveBeenCalledTimes(1);
    });

    it('is null when the pull brings nothing: the viewer has no access', async () => {
        const pull = vi.fn(async () => {});

        expect(await findSharedNotePath(FILE, pull)).toBeNull();
        expect(pull).toHaveBeenCalledTimes(1);
    });

    it('is null when the owner does not answer', async () => {
        const pull = vi.fn(async () => { throw new Error('owner.example.com did not answer'); });

        expect(await findSharedNotePath(FILE, pull)).toBeNull();
    });
});
