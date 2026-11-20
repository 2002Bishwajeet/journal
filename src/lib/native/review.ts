// Ask for an App Store / Play rating with the system dialog (#1439). Native iOS and Android
// only. The counters live in local storage on the device and never leave it.
import { hasNativePlugin, invokeNative, nativePlatform, type NativePlatform } from '@/lib/native';
import { BRIDGE_PLUGIN } from '@/lib/native/bridge';
import { localDateKey } from '@/lib/reminderSchedule';

export const REVIEW_STATE_KEY = 'journal-review-prompt';
export const REVIEW_MIN_DAYS = 3;
export const REVIEW_MIN_NOTES = 5;
export const REVIEW_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

const APP_STORE_ID = '6833436628';
const PLAY_PACKAGE = 'com.biswa.journal';

export interface ReviewState {
    /** Distinct local dates a note was saved, kept only up to `REVIEW_MIN_DAYS`. */
    days: string[];
    lastVersion: string | null;
    lastAt: string | null;
}

export interface ReviewContext {
    platform: NativePlatform | null;
    state: ReviewState;
    noteCount: number;
    version: string;
    now: Date;
    /** An edit, the paywall or onboarding is in front of the user. */
    busy: boolean;
}

export function reviewEligible({ platform, state, noteCount, version, now, busy }: ReviewContext): boolean {
    if (platform !== 'ios' && platform !== 'android') return false;
    if (busy) return false;
    if (state.days.length < REVIEW_MIN_DAYS || noteCount < REVIEW_MIN_NOTES) return false;
    if (state.lastVersion === version) return false;
    if (state.lastAt !== null && now.getTime() - new Date(state.lastAt).getTime() < REVIEW_INTERVAL_MS) return false;
    return true;
}

export function readReviewState(): ReviewState {
    try {
        const parsed = JSON.parse(localStorage.getItem(REVIEW_STATE_KEY) ?? 'null') as Partial<ReviewState> | null;
        return {
            days: Array.isArray(parsed?.days) ? parsed.days : [],
            lastVersion: parsed?.lastVersion ?? null,
            lastAt: parsed?.lastAt ?? null,
        };
    } catch {
        return { days: [], lastVersion: null, lastAt: null };
    }
}

function writeReviewState(state: ReviewState): void {
    localStorage.setItem(REVIEW_STATE_KEY, JSON.stringify(state));
}

/** Counts `now`'s local date as a day a note was saved. */
export function recordNoteSaveDay(now: Date): void {
    const state = readReviewState();
    const day = localDateKey(now, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (state.days.length >= REVIEW_MIN_DAYS || state.days.includes(day)) return;
    writeReviewState({ ...state, days: [...state.days, day] });
}

/**
 * Shows the system rating dialog when `reviewEligible`, and records it so the version and
 * 90-day caps hold. Needs the bridge plugin: without it nothing is shown or recorded.
 */
export async function maybeRequestReview(noteCount: number, busy: boolean): Promise<boolean> {
    const now = new Date();
    const state = readReviewState();
    const eligible = reviewEligible({ platform: nativePlatform(), state, noteCount, version: __APP_VERSION__, now, busy });
    if (!eligible || !hasNativePlugin(BRIDGE_PLUGIN)) return false;
    writeReviewState({ ...state, lastVersion: __APP_VERSION__, lastAt: now.toISOString() });
    try {
        await invokeNative(BRIDGE_PLUGIN, 'request_review');
    } catch (err) {
        console.warn('[review] Rating request failed:', err);
    }
    return true;
}

/** The store page where a person writes a review, or null off iOS and Android. */
export function storeReviewUrl(platform: NativePlatform | null): string | null {
    if (platform === 'ios') return `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;
    if (platform === 'android') return `market://details?id=${PLAY_PACKAGE}`;
    return null;
}

export async function openStoreReview(): Promise<void> {
    const url = storeReviewUrl(nativePlatform());
    if (!url) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:opener|open_url', { url });
}
