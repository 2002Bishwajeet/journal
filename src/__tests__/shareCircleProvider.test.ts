/**
 * ShareCircleProvider (#730): Journal's own circle on the owner's identity, through the
 * V2 connections API. The HTTP client is stubbed at the SDK's createAxiosClient.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { ShareCircleProvider } from '@/lib/homebase/ShareCircleProvider';
import { JOURNAL_APP_ID, JOURNAL_DRIVE } from '@/lib/homebase/config';

const ROOT = 'https://owner.dotyou.cloud';
const V2 = `${ROOT}/api/v2/connections/circles`;
const SHARES_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const READ_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

const post = vi.fn();
const get = vi.fn();
const createAxiosClient = vi.fn(() => ({ post, get }));

const client = {
    getRoot: () => ROOT,
    getHeaders: () => ({ bx0900: 'app-token' }),
    createAxiosClient,
} as unknown as DotYouClient;

const refusal = (status: number, data: Record<string, unknown>) =>
    Object.assign(new Error('refused'), { response: { status, data } });

const notOwned = refusal(403, {
    title: `App ${JOURNAL_APP_ID} can grant only Read, with the storage key, on drive x, which it does not own`,
});

/** Routes POSTs by endpoint; `create` answers per slug. */
function routePosts(create: (slug: string) => string | Error, add?: (odinId: string) => Error | undefined) {
    post.mockImplementation(async (url: string, body: { slug?: string; odinId?: string }) => {
        if (url === `${V2}/create`) {
            const result = create(body.slug ?? '');
            if (result instanceof Error) throw result;
            return { data: result };
        }
        if (url === `${V2}/add`) {
            const err = add?.(body.odinId ?? '');
            if (err) throw err;
        }
        return { data: null };
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: [] });
});

describe('ensureShareCircle', () => {
    it('creates journal-shares with all four drive permissions, over V2 with the app token as Bearer', async () => {
        routePosts(() => SHARES_ID);

        const circle = await new ShareCircleProvider(client).ensureShareCircle();

        expect(circle).toEqual({ circleId: SHARES_ID, canEdit: true });
        expect(post).toHaveBeenCalledWith(`${V2}/create`, expect.objectContaining({
            slug: 'journal-shares',
            driveGrants: [{ permissionedDrive: { drive: JOURNAL_DRIVE, permission: 15 } }],
            permissions: { keys: [] },
        }));
        expect(createAxiosClient).toHaveBeenCalledWith({ headers: { Authorization: 'Bearer app-token' } });
    });

    it('falls back to a Read-only journal-read circle when the drive is not Journal\'s', async () => {
        routePosts((slug) => (slug === 'journal-shares' ? notOwned : READ_ID));

        const circle = await new ShareCircleProvider(client).ensureShareCircle();

        expect(circle).toEqual({ circleId: READ_ID, canEdit: false });
        expect(post).toHaveBeenLastCalledWith(`${V2}/create`, expect.objectContaining({
            slug: 'journal-read',
            driveGrants: [{ permissionedDrive: { drive: JOURNAL_DRIVE, permission: 1 } }],
        }));
    });

    it('rethrows any other refusal', async () => {
        routePosts(() => refusal(403, { title: 'missing permission key' }));

        await expect(new ShareCircleProvider(client).ensureShareCircle()).rejects.toThrow('refused');
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('creates the circle once per provider', async () => {
        routePosts(() => SHARES_ID);
        const provider = new ShareCircleProvider(client);

        await provider.enroll(['a.id']);
        await provider.unenroll(['a.id']);

        expect(post.mock.calls.filter(([url]) => url === `${V2}/create`)).toHaveLength(1);
    });

    it('moves the members of journal-read into journal-shares once the drive is Journal\'s, then deletes it', async () => {
        routePosts(() => SHARES_ID);
        get.mockResolvedValue({
            data: [{
                circle: { id: READ_ID, slug: 'journal-read', appId: JOURNAL_APP_ID },
                members: ['a.id'],
                pendingMembers: [{ odinId: 'b.id' }],
            }],
        });

        await new ShareCircleProvider(client).ensureShareCircle();

        expect(post).toHaveBeenCalledWith(`${V2}/add`, { circleId: SHARES_ID, odinId: 'a.id' });
        expect(post).toHaveBeenCalledWith(`${V2}/add`, { circleId: SHARES_ID, odinId: 'b.id' });
        expect(post).toHaveBeenLastCalledWith(`${V2}/delete?removeMembers=true`, READ_ID);
    });

    it('keeps journal-read while someone could not be moved', async () => {
        routePosts(() => SHARES_ID, () => refusal(400, { errorCode: 'contactNotReviewed' }));
        get.mockResolvedValue({
            data: [{ circle: { id: READ_ID, slug: 'journal-read', appId: JOURNAL_APP_ID }, members: ['a.id'] }],
        });

        await new ShareCircleProvider(client).ensureShareCircle();

        expect(post).not.toHaveBeenCalledWith(expect.stringContaining('/delete'), expect.anything());
    });
});

describe('enroll', () => {
    it('adds each person on their own and maps the refusals', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        routePosts(() => SHARES_ID, (odinId) => ({
            'new.id': refusal(400, { errorCode: 'contactNotReviewed' }),
            'stranger.id': refusal(400, { errorCode: 'notAConnectedIdentity' }),
            'broken.id': refusal(500, {}),
        })[odinId]);

        const results = await new ShareCircleProvider(client).enroll(['a.id', 'new.id', 'stranger.id', 'broken.id']);

        expect(results).toEqual([
            { odinId: 'a.id', status: 'added' },
            { odinId: 'new.id', status: 'contactNotReviewed' },
            { odinId: 'stranger.id', status: 'notAConnectedIdentity' },
            { odinId: 'broken.id', status: 'failed' },
        ]);
        expect(post).toHaveBeenCalledWith(`${V2}/add`, { circleId: SHARES_ID, odinId: 'a.id' });
    });
});

describe('unenroll and members', () => {
    it('revokes each person and keeps going after a failure', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        post.mockImplementation(async (url: string, body: { odinId?: string }) => {
            if (url === `${V2}/create`) return { data: SHARES_ID };
            if (body.odinId === 'a.id') throw refusal(500, {});
            return { data: null };
        });

        await new ShareCircleProvider(client).unenroll(['a.id', 'b.id']);

        expect(post).toHaveBeenCalledWith(`${V2}/revoke`, { circleId: SHARES_ID, odinId: 'a.id' });
        expect(post).toHaveBeenCalledWith(`${V2}/revoke`, { circleId: SHARES_ID, odinId: 'b.id' });
    });
});

// #897: people named on a note as viewers get Read only, from a circle of their own
describe('viewers', () => {
    const VIEWERS_ID = 'cccccccc-0000-0000-0000-000000000003';

    it('creates journal-viewers with Read only, once, and adds each person to it', async () => {
        routePosts((slug) => (slug === 'journal-viewers' ? VIEWERS_ID : SHARES_ID));
        const provider = new ShareCircleProvider(client);

        const results = await provider.enrollViewers(['sam.id']);
        await provider.enrollViewers(['pip.id']);

        expect(results).toEqual([{ odinId: 'sam.id', status: 'added' }]);
        const creates = post.mock.calls.filter(([url]) => url === `${V2}/create`);
        expect(creates).toHaveLength(1);
        expect(creates[0][1]).toMatchObject({
            slug: 'journal-viewers',
            driveGrants: [{ permissionedDrive: { drive: JOURNAL_DRIVE, permission: 1 } }],
        });
        expect(post).toHaveBeenCalledWith(`${V2}/add`, { circleId: VIEWERS_ID, odinId: 'sam.id' });
        expect(post).toHaveBeenCalledWith(`${V2}/add`, { circleId: VIEWERS_ID, odinId: 'pip.id' });
        // Neither the share circle nor journal-read is looked at
        expect(get).not.toHaveBeenCalled();
    });

    it('removes people from journal-viewers only', async () => {
        routePosts((slug) => (slug === 'journal-viewers' ? VIEWERS_ID : SHARES_ID));

        await new ShareCircleProvider(client).unenrollViewers(['sam.id']);

        expect(post).toHaveBeenCalledWith(`${V2}/revoke`, { circleId: VIEWERS_ID, odinId: 'sam.id' });
        expect(post).not.toHaveBeenCalledWith(`${V2}/create`, expect.objectContaining({ slug: 'journal-shares' }));
    });
});
