import { httpStatus } from './httpStatus';

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

/** Tests only. */
export function resetShareNotificationsForTests(): void {
    offHosts = [];
}
