import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

// Passthrough so we can observe resolveSyncErrorsForEntity calls from SyncService
vi.mock('@/lib/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/db')>();
    return { ...actual, resolveSyncErrorsForEntity: vi.fn(actual.resolveSyncErrorsForEntity) };
});
import { resolveSyncErrorsForEntity } from '@/lib/db';

const { mockProcessChanges } = vi.hoisted(() => ({ mockProcessChanges: vi.fn() }));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor {
        processChanges = mockProcessChanges;
        constructor() {}
    },
}));

import { SyncService } from '@/lib/homebase/SyncService';

const dotYouClient = fakeDotYouClient('sam.dotyou.cloud');
const fakeOnline = fakeOnlineContext();

function uuid(n: number): string {
    return `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;
}
function remoteFile(n: number) {
    return {
        fileId: `file-${n}`,
        fileState: 'active',
        fileMetadata: { versionTag: `v${n}`, updated: 1700000000000, appData: { uniqueId: uuid(n) } },
    } as never;
}
const notesOf = (count: number) => Array.from({ length: count }, (_, i) => remoteFile(i + 1));

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

describe('SyncService.pullChanges', () => {
    let svc: SyncService;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        svc = new SyncService(dotYouClient, fakeOnline);
    });
    afterEach(() => { vi.restoreAllMocks(); });

    function setRemote(folders: unknown[], notes: unknown[]) {
        mockProcessChanges.mockResolvedValue({ folders, notes, invitations: [], processedresult: null });
    }

    it('handles every remote note', async () => {
        setRemote([], notesOf(7));
        const spy = vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockResolvedValue();

        const result = await svc.pullChanges();

        expect(spy).toHaveBeenCalledTimes(7);
        expect(result).toEqual({ folders: 0, notes: 7 });
    });

    it('processes notes at most 5 at a time', async () => {
        setRemote([], notesOf(7));
        let inFlight = 0;
        let peak = 0;
        const pending: Array<() => void> = [];
        vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockImplementation(async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise<void>(resolve => pending.push(resolve));
            inFlight--;
        });

        let done = false;
        const pull = svc.pullChanges().finally(() => { done = true; });
        while (!done) {
            await new Promise(r => setTimeout(r, 5));
            pending.splice(0).forEach(resolve => resolve());
        }
        const result = await pull;

        expect(peak).toBe(5);
        expect(result.notes).toBe(7);
    });

    it('keeps handling other notes when one rejects and records a pull error for it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        setRemote([], notesOf(7));
        const failingId = uuid(3);
        const spy = vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockImplementation(async (file) => {
            if (file.fileMetadata.appData.uniqueId === failingId) throw new Error('boom');
        });

        const result = await svc.pullChanges();

        expect(spy).toHaveBeenCalledTimes(7);
        expect(result.notes).toBe(6);
        const rows = await db.query<{ entity_id: string; operation: string }>(
            'SELECT entity_id, operation FROM sync_errors',
        );
        expect(rows.rows).toEqual([{ entity_id: failingId, operation: 'pull' }]);
    });

    it('handles all folders before the first note', async () => {
        const folders = [remoteFile(101), remoteFile(102)];
        setRemote(folders, notesOf(3));
        const order: string[] = [];
        vi.spyOn(SyncService.prototype, 'handleRemoteFolder').mockImplementation(async () => { order.push('folder'); });
        vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockImplementation(async () => { order.push('note'); });

        const result = await svc.pullChanges();

        expect(order).toEqual(['folder', 'folder', 'note', 'note', 'note']);
        expect(result).toEqual({ folders: 2, notes: 3 });
    });

    it('does not resolve sync errors per entity when none are unresolved', async () => {
        setRemote([remoteFile(101)], notesOf(3));
        vi.spyOn(SyncService.prototype, 'handleRemoteFolder').mockResolvedValue();
        vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockResolvedValue();

        await svc.pullChanges();

        expect(resolveSyncErrorsForEntity).not.toHaveBeenCalled();
    });
});
