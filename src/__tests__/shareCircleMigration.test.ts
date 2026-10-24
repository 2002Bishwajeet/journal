/**
 * One-time enrollment of the people old notes were shared with into the share circle (#734).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: new Map<string, number>(),
    getAppState: vi.fn(),
    saveAppState: vi.fn(),
    getRecipientsOfOwnNotes: vi.fn(),
    getCircleIdsOfOwnNotes: vi.fn(),
    fetchMembersOfCircle: vi.fn(),
    enroll: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    getAppState: mocks.getAppState,
    saveAppState: mocks.saveAppState,
    getRecipientsOfOwnNotes: mocks.getRecipientsOfOwnNotes,
    getCircleIdsOfOwnNotes: mocks.getCircleIdsOfOwnNotes,
}));
vi.mock('@homebase-id/js-lib/network', () => ({ fetchMembersOfCircle: mocks.fetchMembersOfCircle }));
vi.mock('@/lib/homebase/ShareCircleProvider', () => ({
    ShareCircleProvider: class {
        enroll = mocks.enroll;
    },
}));

import { migrateShareCircle } from '@/lib/homebase/shareCircleMigration';
import type { DotYouClient } from '@homebase-id/js-lib/core';

const OWNER = 'me.id';
const client = {} as DotYouClient;
const added = (odinId: string) => ({ odinId, status: 'added' });

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.state.clear();
    mocks.getAppState.mockImplementation(async (key: string) => mocks.state.get(key) ?? null);
    mocks.saveAppState.mockImplementation(async (key: string, value: number) => { mocks.state.set(key, value); });
    mocks.getRecipientsOfOwnNotes.mockResolvedValue(['a.id', 'b.id']);
    mocks.getCircleIdsOfOwnNotes.mockResolvedValue(['circle-1']);
    mocks.fetchMembersOfCircle.mockResolvedValue([{ domain: 'b.id' }, { domain: 'c.id' }, { domain: OWNER }]);
    mocks.enroll.mockImplementation(async (ids: string[]) => ids.map(added));
});

describe('migrateShareCircle', () => {
    it('enrolls the union of recipients and circle members once, without the owner', async () => {
        await migrateShareCircle(client, OWNER);

        expect(mocks.enroll).toHaveBeenCalledTimes(1);
        expect([...mocks.enroll.mock.calls[0][0]].sort()).toEqual(['a.id', 'b.id', 'c.id']);
    });

    it('sets the flag after every enrollment worked', async () => {
        await migrateShareCircle(client, OWNER);

        expect(mocks.state.get('shareCircleMigrated')).toBe(1);
    });

    it('sets the flag when a person is refused for good', async () => {
        mocks.enroll.mockResolvedValue([added('a.id'), { odinId: 'b.id', status: 'notAConnectedIdentity' }]);

        await migrateShareCircle(client, OWNER);

        expect(mocks.state.get('shareCircleMigrated')).toBe(1);
    });

    it('leaves the flag unset after contactNotReviewed', async () => {
        mocks.enroll.mockResolvedValue([added('a.id'), { odinId: 'b.id', status: 'contactNotReviewed' }]);

        await migrateShareCircle(client, OWNER);

        expect(mocks.state.has('shareCircleMigrated')).toBe(false);
        expect(mocks.state.get('shareCircleMigrationTries')).toBe(1);
    });

    it('leaves the flag unset after a network error', async () => {
        mocks.enroll.mockRejectedValue(new Error('offline'));

        await migrateShareCircle(client, OWNER);

        expect(mocks.state.has('shareCircleMigrated')).toBe(false);
    });

    it('stops after 5 tries', async () => {
        mocks.enroll.mockResolvedValue([{ odinId: 'a.id', status: 'failed' }]);

        for (let i = 0; i < 4; i++) await migrateShareCircle(client, OWNER);
        expect(mocks.state.has('shareCircleMigrated')).toBe(false);

        await migrateShareCircle(client, OWNER);
        expect(mocks.state.get('shareCircleMigrated')).toBe(1);

        await migrateShareCircle(client, OWNER);
        expect(mocks.enroll).toHaveBeenCalledTimes(5);
    });

    it('does nothing when the flag is set', async () => {
        mocks.state.set('shareCircleMigrated', 1);

        await migrateShareCircle(client, OWNER);

        expect(mocks.enroll).not.toHaveBeenCalled();
        expect(mocks.saveAppState).not.toHaveBeenCalled();
    });

    it('writes only its own app state, no note', async () => {
        await migrateShareCircle(client, OWNER);

        expect(mocks.saveAppState.mock.calls.map((c) => c[0])).toEqual(['shareCircleMigrated']);
    });
});
