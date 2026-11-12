// @vitest-environment happy-dom
/** The daily reminder hook (#1139): arms the registered scheduler, and only then. */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let latestModified: string | null = null;
let loading = false;
vi.mock('@/hooks/useLiveQuery', () => ({
    useLiveQuery: (_sql: string, _params: unknown[], _key: string, enabled: boolean) => ({
        data: enabled ? [{ modified: latestModified }] : [],
        isLoading: enabled && loading,
    }),
}));

import { useDailyReminder } from '@/hooks/useDailyReminder';
import {
    clearReminders,
    registerReminderScheduler,
    setReminderPrefs,
    REMINDER_PREFS_KEY,
    type ReminderPermission,
    type ReminderScheduler,
} from '@/lib/native/reminders';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe() {
    useDailyReminder();
    return null;
}

function fakeScheduler(permission: ReminderPermission = 'granted') {
    const replaceAll = vi.fn<ReminderScheduler["replaceAll"]>(async () => {});
    const cancelAll = vi.fn(async () => {});
    const scheduler: ReminderScheduler = {
        permission: async () => permission,
        requestPermission: async () => permission,
        openSystemSettings: async () => {},
        replaceAll,
        cancelAll,
    };
    return { scheduler, replaceAll, cancelAll };
}

const lastEntries = (replaceAll: ReturnType<typeof fakeScheduler>['replaceAll']) => replaceAll.mock.calls.at(-1)![0];
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('useDailyReminder', () => {
    let root: Root;

    const mount = async () => {
        root = createRoot(document.createElement('div'));
        await act(async () => root.render(h(Probe)));
        await flush();
    };

    beforeEach(() => {
        localStorage.clear();
        latestModified = null;
        loading = false;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-06-10T12:00:00'));
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        registerReminderScheduler(null);
        vi.useRealTimers();
    });

    it('does nothing without a scheduler', async () => {
        setReminderPrefs({ enabled: true });
        await mount();
        // Nothing to call, nothing thrown: a scheduler registered later is armed.
        const { scheduler, replaceAll } = fakeScheduler();
        await act(async () => registerReminderScheduler(scheduler));
        await flush();
        expect(replaceAll).toHaveBeenCalledTimes(1);
    });

    it('arms 14 days at the chosen time on launch', async () => {
        const { scheduler, replaceAll, cancelAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true, time: '21:15' });
        await mount();
        expect(replaceAll).toHaveBeenCalledTimes(1);
        const entries = lastEntries(replaceAll);
        expect(entries).toHaveLength(14);
        expect(entries[0].at).toBe('2026-06-10T21:15');
        expect(entries.every((e) => e.url === 'journal://today')).toBe(true);
        expect(cancelAll).not.toHaveBeenCalled();
    });

    it('does not arm without permission', async () => {
        const { scheduler, replaceAll } = fakeScheduler('denied');
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true });
        await mount();
        expect(replaceAll).not.toHaveBeenCalled();
    });

    it('skips today once a note was written today, and re-arms when that happens', async () => {
        const { scheduler, replaceAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true, time: '21:00' });
        await mount();
        expect(lastEntries(replaceAll)[0].date).toBe('2026-06-10');

        latestModified = new Date('2026-06-10T09:00:00').toISOString();
        await act(async () => root.render(h(Probe)));
        await flush();
        expect(replaceAll).toHaveBeenCalledTimes(2);
        expect(lastEntries(replaceAll)[0].date).toBe('2026-06-11');
    });

    it('does not re-arm for another save on the same day', async () => {
        const { scheduler, replaceAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true });
        latestModified = new Date('2026-06-10T09:00:00').toISOString();
        await mount();
        const calls = replaceAll.mock.calls.length;
        latestModified = new Date('2026-06-10T10:00:00').toISOString();
        await act(async () => root.render(h(Probe)));
        await flush();
        expect(replaceAll).toHaveBeenCalledTimes(calls);
    });

    it('waits for the notes to load before arming', async () => {
        const { scheduler, replaceAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true });
        loading = true;
        await mount();
        expect(replaceAll).not.toHaveBeenCalled();
    });

    it('re-arms when the app returns to the foreground', async () => {
        const { scheduler, replaceAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true, time: '09:00' });
        await mount();
        expect(lastEntries(replaceAll)[0].date).toBe('2026-06-11');

        vi.setSystemTime(new Date('2026-06-11T08:00:00'));
        window.dispatchEvent(new Event('focus'));
        await flush();
        expect(replaceAll).toHaveBeenCalledTimes(2);
        expect(lastEntries(replaceAll)[0].date).toBe('2026-06-11');
    });

    it('replaces every entry when the time changes', async () => {
        const { scheduler, replaceAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true, time: '20:00' });
        await mount();
        await act(async () => setReminderPrefs({ time: '07:30' }));
        await flush();
        expect(replaceAll).toHaveBeenCalledTimes(2);
        expect(lastEntries(replaceAll).every((e) => e.time === '07:30')).toBe(true);
    });

    it('cancels everything when the reminder is turned off', async () => {
        const { scheduler, replaceAll, cancelAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true });
        await mount();
        await act(async () => setReminderPrefs({ enabled: false }));
        await flush();
        expect(cancelAll).toHaveBeenCalledTimes(1);
        expect(replaceAll).toHaveBeenCalledTimes(1);
    });

    it('cancels everything on sign-out and forgets the settings', async () => {
        const { scheduler, cancelAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true });
        await mount();
        await act(async () => { await clearReminders(); });
        expect(cancelAll).toHaveBeenCalled();
        expect(localStorage.getItem(REMINDER_PREFS_KEY)).toBeNull();
    });

    it('stops reacting after unmount', async () => {
        const { scheduler, replaceAll } = fakeScheduler();
        registerReminderScheduler(scheduler);
        setReminderPrefs({ enabled: true });
        await mount();
        await act(async () => root.unmount());
        window.dispatchEvent(new Event('focus'));
        await flush();
        expect(replaceAll).toHaveBeenCalledTimes(1);
    });
});
