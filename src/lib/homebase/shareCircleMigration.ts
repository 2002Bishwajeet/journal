import type { DotYouClient } from '@homebase-id/js-lib/core';
import { fetchMembersOfCircle } from '@homebase-id/js-lib/network';
import { getAppState, saveAppState, getRecipientsOfOwnNotes, getCircleIdsOfOwnNotes } from '@/lib/db';
import { ShareCircleProvider } from './ShareCircleProvider';

export const SHARE_CIRCLE_MIGRATED_KEY = 'shareCircleMigrated';
export const SHARE_CIRCLE_MIGRATION_TRIES_KEY = 'shareCircleMigrationTries';
export const MAX_MIGRATION_TRIES = 5;

/**
 * One-time pass (#734): people the owner shared notes with before the share circle existed
 * (#730) get drive access. Their note ACLs stay as they are; no note is touched.
 * Done when every enrollment worked or was refused for good (`notAConnectedIdentity`);
 * otherwise it runs again next sign-in, and gives up after {@link MAX_MIGRATION_TRIES}.
 */
export async function migrateShareCircle(dotYouClient: DotYouClient, ownerOdinId: string): Promise<void> {
    if (await getAppState<number>(SHARE_CIRCLE_MIGRATED_KEY)) return;

    let settled = false;
    let enrolled = 0;
    let total = 0;
    try {
        const [recipients, circleIds] = await Promise.all([
            getRecipientsOfOwnNotes(ownerOdinId),
            getCircleIdsOfOwnNotes(ownerOdinId),
        ]);
        const memberLists = await Promise.all(circleIds.map((id) => fetchMembersOfCircle(dotYouClient, id)));
        const everyone = [
            ...new Set([...recipients, ...memberLists.flatMap((l) => (l ?? []).map((m) => m.domain))]),
        ].filter((odinId) => odinId && odinId !== ownerOdinId);
        total = everyone.length;

        if (total === 0) {
            settled = true;
        } else {
            const results = await new ShareCircleProvider(dotYouClient).enroll(everyone);
            enrolled = results.filter((r) => r.status === 'added').length;
            settled = results.every((r) => r.status === 'added' || r.status === 'notAConnectedIdentity');
        }
    } catch (err) {
        console.error('[ShareCircleMigration] Could not enroll recipients:', err);
    }

    const tries = ((await getAppState<number>(SHARE_CIRCLE_MIGRATION_TRIES_KEY)) ?? 0) + 1;
    const gaveUp = !settled && tries >= MAX_MIGRATION_TRIES;
    console.info(`[ShareCircleMigration] ${enrolled}/${total} recipients enrolled (try ${tries})${gaveUp ? ', giving up' : ''}`);
    if (settled || gaveUp) await saveAppState(SHARE_CIRCLE_MIGRATED_KEY, 1);
    else await saveAppState(SHARE_CIRCLE_MIGRATION_TRIES_KEY, tries);
}
