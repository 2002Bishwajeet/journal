/**
 * #153: a bulk pull suspends the live list queries for its duration and resumes
 * them exactly once, even when note handling fails; small pulls stay live.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockProcessChanges, mockSuspend, mockResume } = vi.hoisted(() => ({
    mockProcessChanges: vi.fn(),
    mockSuspend: vi.fn(),
    mockResume: vi.fn(),
}));
vi.mock('@/hooks/useLiveQuery', () => ({ suspendLiveQueries: mockSuspend }));
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

function remoteNotes(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        fileState: 'active',
        fileMetadata: { appData: { uniqueId: `80000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}` } },
    }));
}

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => { await closeTestDatabase(); });

describe('SyncService.pullChanges live-query suspension (#153)', () => {
    let svc: SyncService;

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        mockSuspend.mockReturnValue(mockResume);
        svc = new SyncService(fakeDotYouClient(), fakeOnlineContext());
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('suspends once for a 25-note pull and resumes once after the last note', async () => {
        mockProcessChanges.mockResolvedValue({ folders: [], notes: remoteNotes(25), invitations: [] });
        const handle = vi.spyOn(svc, 'handleRemoteNote').mockResolvedValue(undefined as never);

        const result = await svc.pullChanges();

        expect(result.notes).toBe(25);
        expect(mockSuspend).toHaveBeenCalledTimes(1);
        expect(mockResume).toHaveBeenCalledTimes(1);
        expect(mockSuspend.mock.invocationCallOrder[0]).toBeLessThan(handle.mock.invocationCallOrder[0]);
        expect(mockResume.mock.invocationCallOrder[0]).toBeGreaterThan(handle.mock.invocationCallOrder.at(-1)!);
    });

    it('still resumes once when note handlers throw', async () => {
        mockProcessChanges.mockResolvedValue({ folders: [], notes: remoteNotes(25), invitations: [] });
        vi.spyOn(svc, 'handleRemoteNote').mockRejectedValue(new Error('boom'));

        const result = await svc.pullChanges();

        expect(result.notes).toBe(0);
        expect(mockSuspend).toHaveBeenCalledTimes(1);
        expect(mockResume).toHaveBeenCalledTimes(1);
    });

    it('still resumes once when a failure escapes the pull', async () => {
        mockProcessChanges.mockResolvedValue({ folders: [], notes: remoteNotes(25), invitations: [] });
        vi.spyOn(svc, 'handleRemoteNote').mockRejectedValue(new Error('boom'));
        // logSyncError is private; failing it lets the error escape the loop.
        const withLog = svc as unknown as { logSyncError: () => Promise<void> };
        vi.spyOn(withLog, 'logSyncError').mockRejectedValue(new Error('db down'));

        await expect(svc.pullChanges()).rejects.toThrow('db down');

        expect(mockSuspend).toHaveBeenCalledTimes(1);
        expect(mockResume).toHaveBeenCalledTimes(1);
    });

    it('stays live for a small (3-note) pull', async () => {
        mockProcessChanges.mockResolvedValue({ folders: [], notes: remoteNotes(3), invitations: [] });
        vi.spyOn(svc, 'handleRemoteNote').mockResolvedValue(undefined as never);

        const result = await svc.pullChanges();

        expect(result.notes).toBe(3);
        expect(mockSuspend).not.toHaveBeenCalled();
    });
});
