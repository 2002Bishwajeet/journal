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

const { mockProcessChanges, mockGetNote } = vi.hoisted(() => ({ mockProcessChanges: vi.fn(), mockGetNote: vi.fn() }));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        getNote = mockGetNote;
        constructor() {}
    },
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

    describe('retrying notes whose pull failed (#147)', () => {
        async function insertPullError(id: string, retryCount: number) {
            await db.query(
                `INSERT INTO sync_errors (entity_id, entity_type, operation, error_message, retry_count, next_retry_at)
                 VALUES ($1, 'note', 'pull', 'boom', $2, CURRENT_TIMESTAMP - INTERVAL '1 minute')`,
                [id, retryCount],
            );
        }
        async function pullRows(id: string) {
            const rows = await db.query<{ resolved_at: Date | null; retry_count: number }>(
                `SELECT resolved_at, retry_count FROM sync_errors WHERE entity_id = $1 AND operation = 'pull'`, [id],
            );
            return rows.rows;
        }

        it('retries a failed note on the next sync via getNote and resolves its error', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const id = uuid(3);
            setRemote([], [remoteFile(3)]);
            const spy = vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockRejectedValueOnce(new Error('boom'));

            await svc.pullChanges();
            expect(await pullRows(id)).toEqual([{ resolved_at: null, retry_count: 1 }]);

            await db.query(`UPDATE sync_errors SET next_retry_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'`);
            setRemote([], []);
            const header = remoteFile(3);
            mockGetNote.mockResolvedValue(header);
            spy.mockResolvedValue();

            const result = await svc.pullChanges();

            expect(mockGetNote).toHaveBeenCalledWith(id, undefined, { decrypt: false });
            expect(spy).toHaveBeenLastCalledWith(header);
            expect(result.notes).toBe(1);
            const rows = await pullRows(id);
            expect(rows).toHaveLength(1);
            expect(rows[0].resolved_at).not.toBeNull();
        });

        it('does not fetch a note that already failed 5 times', async () => {
            const id = uuid(3);
            await insertPullError(id, 5);
            setRemote([], []);
            const spy = vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockResolvedValue();

            const result = await svc.pullChanges();

            expect(mockGetNote).not.toHaveBeenCalled();
            expect(spy).not.toHaveBeenCalled();
            expect(result.notes).toBe(0);
            expect(await pullRows(id)).toEqual([{ resolved_at: null, retry_count: 5 }]);
        });

        it('handles a retry id that is also in this pull once, not twice', async () => {
            const id = uuid(3);
            await insertPullError(id, 1);
            setRemote([], [remoteFile(3)]);
            const spy = vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockResolvedValue();

            const result = await svc.pullChanges();

            expect(spy).toHaveBeenCalledTimes(1);
            expect(mockGetNote).not.toHaveBeenCalled();
            expect(result.notes).toBe(1);
            expect((await pullRows(id))[0].resolved_at).not.toBeNull();
        });

        it('resolves the error without handling the note when getNote returns null', async () => {
            const id = uuid(3);
            await insertPullError(id, 1);
            setRemote([], []);
            mockGetNote.mockResolvedValue(null);
            const spy = vi.spyOn(SyncService.prototype, 'handleRemoteNote').mockResolvedValue();

            const result = await svc.pullChanges();

            expect(mockGetNote).toHaveBeenCalledWith(id, undefined, { decrypt: false });
            expect(spy).not.toHaveBeenCalled();
            expect(result.notes).toBe(0);
            expect((await pullRows(id))[0].resolved_at).not.toBeNull();
        });
    });
});
