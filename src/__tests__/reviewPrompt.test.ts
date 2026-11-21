// @vitest-environment happy-dom
/** The rating prompt's eligibility rule and its device-local counters (#1439). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativePlatform } from '@/lib/native';

const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<undefined>>(async () => undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.stubGlobal('__APP_VERSION__', '2.0.0');

import {
    REVIEW_INTERVAL_MS,
    REVIEW_STATE_KEY,
    maybeRequestReview,
    readReviewState,
    recordNoteSaveDay,
    reviewEligible,
    storeReviewUrl,
    type ReviewContext,
} from '@/lib/native/review';

const NOW = new Date('2026-11-20T12:00:00Z');
const ready: ReviewContext = {
    platform: 'ios',
    state: { days: ['2026-11-01', '2026-11-05', '2026-11-20'], lastVersion: null, lastAt: null },
    noteCount: 5,
    version: '2.0.0',
    now: NOW,
    busy: false,
};

describe('reviewEligible', () => {
    it.each(['ios', 'android'] as const)('is true on %s with 3 days and 5 notes', (platform) => {
        expect(reviewEligible({ ...ready, platform })).toBe(true);
    });

    it.each<NativePlatform | null>(['macos', 'windows', 'linux', null])('is false on %s (web and desktop)', (platform) => {
        expect(reviewEligible({ ...ready, platform })).toBe(false);
    });

    it('needs 3 days of saving notes', () => {
        expect(reviewEligible({ ...ready, state: { ...ready.state, days: ['2026-11-01', '2026-11-05'] } })).toBe(false);
    });

    it('needs 5 notes', () => {
        expect(reviewEligible({ ...ready, noteCount: 4 })).toBe(false);
    });

    it('is false while an edit, the paywall or onboarding is up', () => {
        expect(reviewEligible({ ...ready, busy: true })).toBe(false);
    });

    it('asks at most once per app version', () => {
        const lastAt = new Date(NOW.getTime() - 2 * REVIEW_INTERVAL_MS).toISOString();
        expect(reviewEligible({ ...ready, state: { ...ready.state, lastVersion: '2.0.0', lastAt } })).toBe(false);
        expect(reviewEligible({ ...ready, state: { ...ready.state, lastVersion: '1.9.0', lastAt } })).toBe(true);
    });

    it('asks at most once every 90 days', () => {
        const state = (ms: number) => ({ ...ready.state, lastVersion: '1.9.0', lastAt: new Date(NOW.getTime() - ms).toISOString() });
        expect(reviewEligible({ ...ready, state: state(REVIEW_INTERVAL_MS - 1000) })).toBe(false);
        expect(reviewEligible({ ...ready, state: state(REVIEW_INTERVAL_MS) })).toBe(true);
    });
});

describe('recordNoteSaveDay', () => {
    beforeEach(() => localStorage.clear());

    it('counts each date once', () => {
        recordNoteSaveDay(new Date('2026-11-20T08:00:00Z'));
        recordNoteSaveDay(new Date('2026-11-20T09:00:00Z'));
        expect(readReviewState().days).toHaveLength(1);
    });

    it('stops at 3 days', () => {
        for (const d of ['01', '03', '05', '07']) recordNoteSaveDay(new Date(`2026-11-${d}T12:00:00Z`));
        expect(readReviewState().days).toHaveLength(3);
    });

    it('survives unreadable stored state', () => {
        localStorage.setItem(REVIEW_STATE_KEY, '{nope');
        expect(readReviewState()).toEqual({ days: [], lastVersion: null, lastAt: null });
    });
});

describe('maybeRequestReview', () => {
    beforeEach(() => {
        localStorage.clear();
        invoke.mockClear();
        localStorage.setItem(REVIEW_STATE_KEY, JSON.stringify({ days: ['a', 'b', 'c'], lastVersion: null, lastAt: null }));
    });
    afterEach(() => {
        delete window.__JOURNAL_NATIVE__;
    });

    it('does nothing on the web', async () => {
        expect(await maybeRequestReview(9, false)).toBe(false);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('does nothing, and keeps the counters, without the bridge plugin', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: [] };
        expect(await maybeRequestReview(9, false)).toBe(false);
        expect(readReviewState().lastAt).toBeNull();
    });

    it('asks once, then not again in the same version', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'android', plugins: ['journal-bridge'] };
        expect(await maybeRequestReview(9, false)).toBe(true);
        expect(invoke).toHaveBeenCalledWith('plugin:journal-bridge|request_review', undefined);
        expect(await maybeRequestReview(9, false)).toBe(false);
        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('does not ask while busy', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: ['journal-bridge'] };
        expect(await maybeRequestReview(9, true)).toBe(false);
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('storeReviewUrl', () => {
    it('points at the write-review page on iOS and the listing on Android only', () => {
        expect(storeReviewUrl('ios')).toBe('itms-apps://apps.apple.com/app/id6833436628?action=write-review');
        expect(storeReviewUrl('android')).toBe('market://details?id=com.biswa.journal');
        expect(storeReviewUrl('macos')).toBeNull();
        expect(storeReviewUrl(null)).toBeNull();
    });
});
