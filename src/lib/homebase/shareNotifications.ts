import { getDrivesByType, type DotYouClient, type DriveDefinition } from '@homebase-id/js-lib/core';
import { drivesEqual, stringGuidsEqual } from '@homebase-id/js-lib/helpers';
import { httpStatus } from './httpStatus';
import { JOURNAL_APP_ID, JOURNAL_DRIVE, JOURNAL_DRIVE_ATTRIBUTES } from './config';

/**
 * Whether the owner's server accepts share pushes (#817). It refuses the upload with a 400
 * when the Journal drive has `allowSubscriptions` off ("App notification recipients can only
 * be specified if the drive is a collaboration drive and allows subscriptions"). A drive
 * created before the current app registration keeps that setting, and consenting again does
 * not change it, so only the owner console can turn it on. Kept per session and identity so
 * later shares skip the push, and shown in Settings › Diagnostics.
 */

let offHosts: readonly string[] = [];
const listeners = new Set<() => void>();

export const SHARE_NOTIFICATIONS_OFF_MESSAGE =
    '[SharePush] Share notifications are off for this journal: its drive does not allow subscriptions';

/** A 400 that says subscriptions, or a 400 with no body to read (the only one this fixed-shape upload gets). */
export function isSubscriptionsRefusal(error: unknown): boolean {
    if (httpStatus(error) !== 400) return false;
    const { data } = (error as { response?: { data?: unknown } }).response ?? {};
    if (data === undefined || data === null || data === '') return true;
    return /subscriptions/i.test(typeof data === 'string' ? data : JSON.stringify(data));
}

export function markShareNotificationsOff(host: string): void {
    if (offHosts.includes(host)) return;
    offHosts = [...offHosts, host];
    listeners.forEach((listener) => listener());
}

export const areShareNotificationsOff = (host: string) => offHosts.includes(host);

export function subscribeShareNotifications(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The hosts that refused, the same array until one is added (a store snapshot). */
export const getShareNotificationsOffHosts = () => offHosts;

/** The three owner-console fixes a share push needs on the journal drive (#848), in the order to do them. */
export type ShareDriveFix = 'subscriptions' | 'attribute' | 'owner';

export const SHARE_DRIVE_FIXES: readonly ShareDriveFix[] = ['subscriptions', 'attribute', 'owner'];

export const SHARE_DRIVE_FIX_STEPS: Record<ShareDriveFix, string> = {
    subscriptions: 'Turn on "Allow subscriptions".',
    attribute: 'Add the attribute IsCollaborativeChannel with the value true.',
    owner: 'Choose "Assign to an app" and pick Journal. The drive keeps its id and your notes.',
};

export type ShareDriveFacts = Partial<Pick<DriveDefinition, 'allowSubscriptions' | 'appId' | 'attributes'>>;

/** The journal drive as an app token sees it, or null when it can't be read (older hosts, offline). */
export async function fetchJournalDriveFacts(client: DotYouClient): Promise<ShareDriveFacts | null> {
    try {
        const { results } = await getDrivesByType(client, JOURNAL_DRIVE.type, 1, 100);
        return results.find((drive) => drivesEqual(drive.targetDriveInfo, JOURNAL_DRIVE)) ?? null;
    } catch {
        return null;
    }
}

/**
 * The fixes still missing. A fact the host did not serve is unknown: it counts as missing only
 * once a push was `refused`, and if the push was refused yet every fact looks fine, all steps show.
 */
export function missingShareDriveFixes(drive: ShareDriveFacts | null, refused: boolean): ShareDriveFix[] {
    const { allowSubscriptions, attributes, appId } = drive ?? {};
    const wanted: Record<ShareDriveFix, boolean | undefined> = {
        subscriptions: allowSubscriptions,
        attribute: attributes && Object.entries(JOURNAL_DRIVE_ATTRIBUTES).every(([key, value]) => attributes[key]?.toLowerCase() === value),
        owner: appId === undefined ? undefined : stringGuidsEqual(appId ?? undefined, JOURNAL_APP_ID),
    };
    const missing = SHARE_DRIVE_FIXES.filter((fix) => wanted[fix] === false || (refused && wanted[fix] === undefined));
    return refused && missing.length === 0 ? [...SHARE_DRIVE_FIXES] : missing;
}

/** Tests only. */
export function resetShareNotificationsForTests(): void {
    offHosts = [];
}
