import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));

const marker = vi.hoisted(() => ({ exists: vi.fn<() => Promise<boolean>>(), mark: vi.fn<() => Promise<void>>() }));
vi.mock('@/lib/homebase/WelcomeSeededDriveProvider', () => ({
    WelcomeSeededDriveProvider: class {
        exists = marker.exists;
        mark = marker.mark;
    },
}));

import { setTestDb } from './pgliteMock';
import { upsertSearchIndex, getAllDocuments, getAppState } from '@/lib/db/queries';
import { seedWelcomeNote, shouldSeedWelcome, WELCOME_SEEDED_KEY, WELCOME_TITLE } from '@/lib/onboarding/welcome';
import type { DotYouClient } from '@homebase-id/js-lib/core';

const client = {} as DotYouClient;

async function addNote(archivalStatus?: number) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId: '30000000-0000-0000-0000-000000000001',
        title: 'Existing',
        plainTextContent: 'body',
        metadata: {
            title: 'Existing',
            folderId: 'main',
            timestamps: { created: now, modified: now },
            excludeFromAI: false,
            ...(archivalStatus !== undefined ? { archivalStatus } : {}),
        },
    });
}

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => {
    await closeTestDatabase();
});
beforeEach(async () => {
    await resetTestDatabase();
    marker.exists.mockReset().mockResolvedValue(false);
    marker.mark.mockReset().mockResolvedValue(undefined);
});

describe('shouldSeedWelcome', () => {
    it('seeds only when nothing says it was offered or exists', () => {
        expect(shouldSeedWelcome({ seededLocally: false, seededRemotely: false, hasNotes: false })).toBe(true);
        expect(shouldSeedWelcome({ seededLocally: true, seededRemotely: false, hasNotes: false })).toBe(false);
        expect(shouldSeedWelcome({ seededLocally: false, seededRemotely: true, hasNotes: false })).toBe(false);
        expect(shouldSeedWelcome({ seededLocally: false, seededRemotely: false, hasNotes: true })).toBe(false);
    });
});

describe('seedWelcomeNote', () => {
    it('creates exactly one welcome note for an empty identity, once', async () => {
        expect(await seedWelcomeNote(client)).not.toBeNull();
        const docs = await getAllDocuments();
        expect(docs.map((d) => d.title)).toEqual([WELCOME_TITLE]);
        expect(await getAppState(WELCOME_SEEDED_KEY)).toBe(true);
        expect(marker.mark).toHaveBeenCalledOnce();

        expect(await seedWelcomeNote(client)).toBeNull();
        expect(await getAllDocuments()).toHaveLength(1);
    });

    it('does not recreate the note after it is deleted on this device', async () => {
        await seedWelcomeNote(client);
        // Deleting the note empties search_index and leaves the flag in app_state.
        const { getDatabase } = await import('@/lib/db/pglite');
        await (await getDatabase()).query('DELETE FROM search_index');
        expect(await getAllDocuments()).toHaveLength(0);
        expect(await seedWelcomeNote(client)).toBeNull();
        expect(await getAllDocuments()).toHaveLength(0);
    });

    it('does not seed on another device once the drive marker exists', async () => {
        marker.exists.mockResolvedValue(true);
        expect(await seedWelcomeNote(client)).toBeNull();
        expect(await getAllDocuments()).toHaveLength(0);
        expect(marker.mark).not.toHaveBeenCalled();
    });

    it('seeds nothing for an identity with notes, trashed ones included, and remembers it', async () => {
        await addNote(2);
        expect(await seedWelcomeNote(client)).toBeNull();
        expect(await getAllDocuments()).toHaveLength(1);
        expect(await getAppState(WELCOME_SEEDED_KEY)).toBe(true);
    });

    it('still seeds when the drive is unreachable', async () => {
        marker.exists.mockRejectedValue(new Error('offline'));
        marker.mark.mockRejectedValue(new Error('offline'));
        expect(await seedWelcomeNote(client)).not.toBeNull();
        expect(await getAllDocuments()).toHaveLength(1);
    });
});
