/**
 * #1170: which sync runs are failures the app shows (Sync Error, Couldn't sync), and that
 * SyncService.sync() reports them instead of only listing them in `errors`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { upsertSyncRecord } from '@/lib/db/queries';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import { didSyncFail, isOutageError } from '@/lib/homebase/sync/syncOutcome';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockProcessChanges } = vi.hoisted(() => ({ mockProcessChanges: vi.fn() }));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor {
        processChanges = mockProcessChanges;
        getCurrentSyncTime = () => Date.now();
        constructor() {}
    },
}));

import { SyncService } from '@/lib/homebase/SyncService';

/** What axios rejects with: no `response` when the request got none. */
const networkError = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const httpError = (status: number) =>
    Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data: {} } });

describe('isOutageError', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('is true for no response, sign-in, permission and server errors', () => {
        expect(isOutageError(networkError())).toBe(true);
        for (const status of [401, 403, 500, 502, 503]) expect(isOutageError(httpError(status))).toBe(true);
    });

    it('is false for a bad change, a conflict, a rate limit or a non-request error', () => {
        for (const status of [400, 404, 409, 429]) expect(isOutageError(httpError(status))).toBe(false);
        expect(isOutageError(new Error('Could not read remote note content'))).toBe(false);
    });

    it('is false for no response in the hermetic e2e build, whose fence aborts every drive request', () => {
        vi.stubEnv('MODE', 'e2e');
        vi.stubGlobal('location', { protocol: 'http:' });
        expect(isOutageError(networkError())).toBe(false);
        expect(isOutageError(httpError(500))).toBe(true);
        // The live e2e suite runs on https against a real Homebase
        vi.stubGlobal('location', { protocol: 'https:' });
        expect(isOutageError(networkError())).toBe(true);
    });
});

describe('didSyncFail', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('fails a run that threw', () => {
        expect(didSyncFail({ error: networkError(), succeeded: 0, outages: 0 })).toBe(true);
        expect(didSyncFail({ error: httpError(400), succeeded: 0, outages: 0 })).toBe(true);
        expect(didSyncFail({ error: new Error('db'), succeeded: 0, outages: 0 })).toBe(true);
    });

    it('fails a run that moved nothing while items hit an outage', () => {
        expect(didSyncFail({ succeeded: 0, outages: 2 })).toBe(true);
    });

    it('passes a run with nothing to do, any success, or only permanent item errors', () => {
        expect(didSyncFail({ succeeded: 0, outages: 0 })).toBe(false);
        expect(didSyncFail({ succeeded: 1, outages: 3 })).toBe(false);
    });

    it('passes a fenced-off request in the hermetic e2e build', () => {
        vi.stubEnv('MODE', 'e2e');
        vi.stubGlobal('location', { protocol: 'http:' });
        expect(didSyncFail({ error: networkError(), succeeded: 0, outages: 0 })).toBe(false);
        expect(didSyncFail({ error: httpError(503), succeeded: 0, outages: 0 })).toBe(true);
    });
});

describe('SyncService.sync() reports a failed run', () => {
    const NOTE_A = '11111111-1111-1111-1111-111111111111';
    const NOTE_B = '22222222-2222-2222-2222-222222222222';
    let svc: SyncService;

    beforeAll(async () => setTestDb(await createTestDatabase()));
    afterAll(async () => { await closeTestDatabase(); });
    beforeEach(async () => {
        await resetTestDatabase();
        vi.restoreAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockProcessChanges.mockResolvedValue({ folders: [], notes: [], invitations: [] });
        svc = new SyncService(fakeDotYouClient(), fakeOnlineContext());
    });

    it('fails when the pull request fails', async () => {
        mockProcessChanges.mockRejectedValue(httpError(503));
        const result = await svc.sync();
        expect(result.failed).toBe(true);
        expect(result.errors).toHaveLength(1);
    });

    it('fails when every push hits an outage, and not when one gets through', async () => {
        await upsertSyncRecord({ localId: NOTE_A, entityType: 'note', syncStatus: 'pending' });
        await upsertSyncRecord({ localId: NOTE_B, entityType: 'note', syncStatus: 'pending' });
        const push = vi.spyOn(svc, 'pushNote').mockRejectedValue(networkError());
        expect((await svc.sync()).failed).toBe(true);

        // Both are now backing off; let them retry, one succeeding
        await resetTestDatabase();
        await upsertSyncRecord({ localId: NOTE_A, entityType: 'note', syncStatus: 'pending' });
        await upsertSyncRecord({ localId: NOTE_B, entityType: 'note', syncStatus: 'pending' });
        push.mockReset().mockImplementation(async (r) => { if (r.localId === NOTE_B) throw networkError(); });
        const result = await svc.sync();
        expect(result.failed).toBeUndefined();
        expect(result.errors).toEqual([]);
    });

    it('does not fail on permanent item errors, which stay in the "couldn\'t sync" count', async () => {
        await upsertSyncRecord({ localId: NOTE_A, entityType: 'note', syncStatus: 'pending' });
        vi.spyOn(svc, 'pushNote').mockRejectedValue(httpError(400));
        expect((await svc.sync()).failed).toBeUndefined();
    });

    it('does not fail "already in progress" or offline', async () => {
        let release!: () => void;
        mockProcessChanges.mockReturnValue(new Promise((r) => { release = () => r({ folders: [], notes: [], invitations: [] }); }));
        const first = svc.sync();
        await vi.waitFor(() => expect(mockProcessChanges).toHaveBeenCalled());
        const second = await svc.sync();
        expect(second.errors).toEqual(['Sync already in progress']);
        expect(second.failed).toBeUndefined();
        release();
        await first;

        const offline = await new SyncService(fakeDotYouClient(), fakeOnlineContext({ isOnline: false })).sync();
        expect(offline.errors).toEqual(['Network offline']);
        expect(offline.failed).toBeUndefined();
    });
});
