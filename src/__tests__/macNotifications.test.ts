// @vitest-environment happy-dom
/** #1123: macOS notifications and the daily reminder through the premium plugin (mocked). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, listen, toast, notifyDesktop } = vi.hoisted(() => ({
    invoke: vi.fn(),
    listen: vi.fn(),
    toast: vi.fn(),
    notifyDesktop: vi.fn(async () => true),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@premium', () => ({ notifyDesktop }));

import {
    hasMacNotifications,
    macReminderScheduler,
    notificationRoute,
    registerMacReminderScheduler,
    routeOpenedNotifications,
} from '@/lib/native/macNotifications';
import { getReminderScheduler, registerReminderScheduler } from '@/lib/native/reminders';
import { notifyNative } from '@/lib/notifyNative';
import { buildReminderSchedule } from '@/lib/reminderSchedule';
import type { NativePlatform } from '@/lib/native';

const PLUGIN = 'journal-notifications';

const setNative = (platform: NativePlatform, plugins: string[] = [PLUGIN]) => {
    window.__JOURNAL_NATIVE__ = { platform, plugins };
};

/** Answers the plugin's commands; `take_opened` hands out `opened` once. */
function answer(responses: Record<string, unknown>, opened: (string | null)[] = []) {
    invoke.mockImplementation(async (cmd: string) => {
        const command = cmd.replace(`plugin:${PLUGIN}|`, '');
        if (command === 'take_opened') return opened.shift() ?? null;
        return responses[command];
    });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    toast.mockReset();
    notifyDesktop.mockClear();
    localStorage.clear();
});

afterEach(() => {
    delete window.__JOURNAL_NATIVE__;
    registerReminderScheduler(null);
    vi.restoreAllMocks();
});

describe('registerMacReminderScheduler', () => {
    it('registers the macOS scheduler in the macOS app with the plugin', () => {
        setNative('macos');
        expect(hasMacNotifications()).toBe(true);
        registerMacReminderScheduler();
        expect(getReminderScheduler()).toBe(macReminderScheduler);
    });

    it.each([
        ['the web', undefined],
        ['the public macOS build', ['macos', []]],
        ['Windows with the premium plugins', ['windows', [PLUGIN]]],
        ['Linux with the premium plugins', ['linux', [PLUGIN]]],
    ] as const)('registers nothing on %s', (_, native) => {
        if (native) setNative(native[0], [...native[1]]);
        registerMacReminderScheduler();
        expect(getReminderScheduler()).toBeNull();
    });
});

describe('macReminderScheduler', () => {
    beforeEach(() => setNative('macos'));

    it('reads and requests the OS permission', async () => {
        answer({ permission: 'prompt', request_permission: 'granted' });
        await expect(macReminderScheduler.permission()).resolves.toBe('prompt');
        await expect(macReminderScheduler.requestPermission()).resolves.toBe('granted');
    });

    it('replaces the pending reminders with the schedule builder entries', async () => {
        answer({});
        const reminders = buildReminderSchedule({
            time: '20:00',
            timeZone: 'Europe/Berlin',
            now: new Date('2026-11-12T10:00:00Z'),
            writtenDates: ['2026-11-13'],
            days: 3,
        });
        await macReminderScheduler.replaceAll(reminders);
        expect(invoke).toHaveBeenCalledWith(`plugin:${PLUGIN}|replace_reminders`, { reminders });
        expect(reminders.map((r) => r.id)).toEqual(['daily-reminder-2026-11-12', 'daily-reminder-2026-11-14']);
    });

    it('cancels every pending reminder and opens System Settings', async () => {
        answer({});
        await macReminderScheduler.cancelAll();
        await macReminderScheduler.openSystemSettings();
        expect(invoke).toHaveBeenCalledWith(`plugin:${PLUGIN}|cancel_reminders`, undefined);
        expect(invoke).toHaveBeenCalledWith(`plugin:${PLUGIN}|open_settings`, undefined);
    });
});

describe('notifyNative on macOS', () => {
    beforeEach(() => {
        setNative('macos');
        vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    });

    it('shows the notification in the note group, opening the note', async () => {
        answer({ notify: true });
        await notifyNative('Ann shared "Plan" with you', '', '/collab/note-1', 'note-1');
        expect(invoke).toHaveBeenCalledWith(`plugin:${PLUGIN}|notify`, {
            title: 'Ann shared "Plan" with you',
            body: '',
            url: '/collab/note-1',
            thread: 'note-1',
        });
        expect(notifyDesktop).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
    });

    it('falls back to the toast when notifications are not allowed', async () => {
        answer({ notify: false });
        await notifyNative('Title', 'Body', '/collab/note-1', 'note-1');
        expect(toast).toHaveBeenCalledWith('Title: Body');
    });

    it('uses the cross-platform notification in the public macOS build', async () => {
        setNative('macos', []);
        await notifyNative('Title', '', '/');
        expect(invoke).not.toHaveBeenCalled();
        expect(notifyDesktop).toHaveBeenCalledWith('Title', '');
    });
});

describe('notificationRoute', () => {
    it.each([
        ['journal://today', '/today'],
        ['/collab/note-1', '/collab/note-1'],
        ['https://evil.example/', null],
        ['//evil.example/x', null],
        ['journal://unknown', null],
    ])('routes %s to %s', (link, route) => {
        expect(notificationRoute(link)).toBe(route);
    });
});

describe('routeOpenedNotifications', () => {
    let opened: (() => void) | undefined;
    const unlisten = vi.fn();

    beforeEach(() => {
        opened = undefined;
        unlisten.mockReset();
        listen.mockImplementation(async (event: string, handler: () => void) => {
            expect(event).toBe('notification://opened');
            opened = handler;
            return unlisten;
        });
    });

    it('opens the notification that launched the app', async () => {
        setNative('macos');
        answer({}, ['journal://today']);
        const navigate = vi.fn();
        routeOpenedNotifications(navigate);
        await flush();
        expect(navigate).toHaveBeenCalledWith('/today');
    });

    it('opens each notification the user opens while the app runs', async () => {
        setNative('macos');
        const queue: (string | null)[] = [];
        answer({}, queue);
        const navigate = vi.fn();
        const stop = routeOpenedNotifications(navigate);
        await flush();
        expect(navigate).not.toHaveBeenCalled();

        queue.push('/collab/note-1');
        opened?.();
        await flush();
        expect(navigate).toHaveBeenCalledWith('/collab/note-1');

        // A link that would leave the app is ignored.
        queue.push('https://evil.example/');
        opened?.();
        await flush();
        expect(navigate).toHaveBeenCalledTimes(1);

        stop();
        expect(unlisten).toHaveBeenCalled();
    });

    it('does nothing outside the macOS app', async () => {
        setNative('windows');
        const navigate = vi.fn();
        routeOpenedNotifications(navigate)();
        await flush();
        expect(listen).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
    });
});
