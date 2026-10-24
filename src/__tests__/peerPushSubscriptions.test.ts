/**
 * #743: every signed-in user subscribes to each connection's Journal peer push, so a
 * share push can reach them. API mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppPermissionType, type ActiveConnection } from '@homebase-id/js-lib/network';
import { getRegistrationParams, createEccPair } from '@homebase-id/js-lib/auth';

const mocks = vi.hoisted(() => ({
    getAppState: vi.fn<(key: string) => Promise<unknown>>(async () => null),
    saveAppState: vi.fn<(key: string, value: unknown) => Promise<void>>(async () => { }),
    getConnections: vi.fn(),
}));
vi.mock('@/lib/db/queries/appState', () => mocks);
vi.mock('@homebase-id/js-lib/network', async (orig) => ({
    ...(await orig<typeof import('@homebase-id/js-lib/network')>()),
    getConnections: mocks.getConnections,
}));

import { runPeerPushPass } from '@/hooks/usePeerPushSubscriptions';
import {
    BASE_PERMISSIONS,
    COLLABORATION_PERMISSIONS,
    JOURNAL_APP_ID,
    JOURNAL_APP_NAME,
    JOURNAL_APP_SLUG,
    JOURNAL_PEER_SUBSCRIPTION_ID,
} from '@/lib/homebase/config';
import { journalDriveRequest } from '@/hooks/auth/useYouAuthAuthorization';
import type { DotYouClient } from '@homebase-id/js-lib/core';

type Body = { identity: string; subscriptionId: string };
let subscribed: Body[];
const api = {
    get: vi.fn(async () => ({ data: subscribed })),
    post: vi.fn<(url: string, body: Body) => Promise<{ data: unknown }>>(async () => ({ data: {} })),
    delete: vi.fn(async (...args: [string, { data: Body }]) => ({ data: args })),
};
const client = { createAxiosClient: () => api } as unknown as DotYouClient;

const connection = (odinId: string) => ({ odinId }) as ActiveConnection;
const setConnections = (...ids: string[]) =>
    mocks.getConnections.mockResolvedValue({ results: ids.map(connection), cursor: undefined });
const pass = (opts: { hasPushPermission?: boolean; force?: boolean } = {}) =>
    runPeerPushPass(client, { hasPushPermission: true, force: true, ...opts });

beforeEach(() => {
    vi.clearAllMocks();
    subscribed = [];
    api.post.mockImplementation(async () => ({ data: {} }));
    mocks.getAppState.mockResolvedValue(null);
    setConnections('a.example.com', 'b.example.com');
});

describe('runPeerPushPass', () => {
    it('subscribes each connection once with the Journal id, then makes no second call', async () => {
        await pass();
        expect(api.post).toHaveBeenCalledTimes(2);
        expect(api.post.mock.calls.map((c) => c[1])).toEqual([
            { identity: 'a.example.com', subscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID },
            { identity: 'b.example.com', subscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID },
        ]);

        subscribed = api.post.mock.calls.map((c) => c[1]);
        api.post.mockClear();
        await pass();
        expect(api.post).not.toHaveBeenCalled();
    });

    it('unsubscribes an identity that is no longer a connection', async () => {
        subscribed = [
            { identity: 'a.example.com', subscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID },
            { identity: 'b.example.com', subscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID },
            { identity: 'gone.example.com', subscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID },
            { identity: 'other.example.com', subscriptionId: 'a-different-app-subscription' },
        ];
        await pass();
        expect(api.post).not.toHaveBeenCalled();
        expect(api.delete).toHaveBeenCalledTimes(1);
        expect(api.delete.mock.calls[0][1].data.identity).toBe('gone.example.com');
    });

    it('keeps going when one subscribe fails', async () => {
        setConnections('a.example.com', 'bad.example.com', 'c.example.com');
        api.post.mockImplementation(async (_u, body) => {
            if (body.identity === 'bad.example.com') throw new Error('boom');
            return { data: {} };
        });
        await pass();
        expect(api.post).toHaveBeenCalledTimes(3);
        expect(mocks.saveAppState).toHaveBeenCalledTimes(1);
    });

    it('makes no calls without SendPushNotifications', async () => {
        await pass({ hasPushPermission: false });
        expect(mocks.getConnections).not.toHaveBeenCalled();
        expect(api.get).not.toHaveBeenCalled();
        expect(api.post).not.toHaveBeenCalled();
        expect(mocks.saveAppState).not.toHaveBeenCalled();
    });

    it('writes app_state once per pass', async () => {
        await pass();
        expect(mocks.saveAppState).toHaveBeenCalledTimes(1);
    });

    it('skips a non-forced pass that ran within a day', async () => {
        mocks.getAppState.mockResolvedValue(Date.now() - 60_000);
        await pass({ force: false });
        expect(mocks.getConnections).not.toHaveBeenCalled();
        expect(mocks.saveAppState).not.toHaveBeenCalled();
    });

    it('runs a non-forced pass when the last run is older than a day', async () => {
        mocks.getAppState.mockResolvedValue(Date.now() - 25 * 60 * 60 * 1000);
        await pass({ force: false });
        expect(api.post).toHaveBeenCalledTimes(2);
    });

    it('pages through all connections', async () => {
        const page1 = Array.from({ length: 100 }, (_, i) => connection(`p${i}.example.com`));
        mocks.getConnections
            .mockResolvedValueOnce({ results: page1, cursor: 100 })
            .mockResolvedValueOnce({ results: [connection('last.example.com')], cursor: undefined });
        await pass();
        expect(api.post).toHaveBeenCalledTimes(101);
    });

    it('does not write app_state when the connection list fails', async () => {
        mocks.getConnections.mockRejectedValue(new Error('offline'));
        await pass();
        expect(mocks.saveAppState).not.toHaveBeenCalled();
    });
});

describe('sign-in permissions', () => {
    it('base permissions hold both keys and are never empty', () => {
        expect(BASE_PERMISSIONS.length).toBeGreaterThan(0);
        expect(BASE_PERMISSIONS).toContain(AppPermissionType.SendPushNotifications);
        expect(BASE_PERMISSIONS).toContain(AppPermissionType.ReadConnections);
        expect(COLLABORATION_PERMISSIONS).toEqual(expect.arrayContaining(BASE_PERMISSIONS));
    });

    it('registration params carry the base permissions', async () => {
        const eccKey = await createEccPair();
        const params = await getRegistrationParams(
            'https://example.com/auth/finalize', JOURNAL_APP_NAME, JOURNAL_APP_ID, JOURNAL_APP_SLUG,
            BASE_PERMISSIONS, undefined, [journalDriveRequest], [journalDriveRequest], undefined, eccKey.publicKey,
        );
        const request = JSON.parse(params.permission_request);
        expect(request.p.split(',').map(Number)).toEqual(BASE_PERMISSIONS);
    });
});
