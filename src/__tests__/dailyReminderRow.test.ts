// @vitest-environment happy-dom
/** Settings -> Notifications "Daily reminder" row (#1139): hidden without a scheduler, asks once, shows the denied state. */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/hooks/usePushNotifications', () => ({
    usePushNotifications: () => ({
        status: 'off',
        busy: false,
        failed: false,
        turnOn: vi.fn(),
        turnOff: vi.fn(),
        testPush: { state: 'idle' },
        sendTest: vi.fn(),
    }),
}));

import NotificationsSection from '@/components/settings/sections/NotificationsSection';
import {
    getReminderPrefs,
    registerReminderScheduler,
    type ReminderPermission,
    type ReminderScheduler,
} from '@/lib/native/reminders';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function scheduler(initial: ReminderPermission, afterRequest: ReminderPermission = initial) {
    const requestPermission = vi.fn(async () => afterRequest);
    const openSystemSettings = vi.fn(async () => {});
    const impl: ReminderScheduler = {
        permission: async () => initial,
        requestPermission,
        openSystemSettings,
        replaceAll: async () => {},
        cancelAll: async () => {},
    };
    return { impl, requestPermission, openSystemSettings };
}

describe('Daily reminder row', () => {
    let host: HTMLDivElement;
    let root: Root;

    const mount = async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root.render(h(NotificationsSection)));
    };
    const toggle = () => host.querySelector<HTMLButtonElement>('#notifications-daily-reminder');
    const click = async (el: HTMLElement | null) => {
        await act(async () => { el?.click(); });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    };

    beforeEach(() => localStorage.clear());
    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        registerReminderScheduler(null);
    });

    it('is hidden without a scheduler (the web)', async () => {
        await mount();
        expect(toggle()).toBeNull();
        expect(host.textContent).not.toContain('Daily reminder');
        expect(host.textContent).toContain('Notify me when someone shares a note');
    });

    it('appears once a scheduler is registered', async () => {
        await mount();
        await act(async () => registerReminderScheduler(scheduler('granted').impl));
        expect(toggle()).not.toBeNull();
        expect(toggle()!.getAttribute('aria-checked')).toBe('false');
    });

    it('turns on when permission is already granted, without asking, and shows the time picker', async () => {
        const s = scheduler('granted');
        registerReminderScheduler(s.impl);
        await mount();
        await click(toggle());
        expect(s.requestPermission).not.toHaveBeenCalled();
        expect(getReminderPrefs().enabled).toBe(true);
        expect(toggle()!.getAttribute('aria-checked')).toBe('true');
        const time = host.querySelector<HTMLInputElement>('#notifications-daily-reminder-time');
        expect(time?.type).toBe('time');
        expect(time?.value).toBe('20:00');
    });

    it('asks for permission once when it has not been asked', async () => {
        const s = scheduler('prompt', 'granted');
        registerReminderScheduler(s.impl);
        await mount();
        await click(toggle());
        expect(s.requestPermission).toHaveBeenCalledTimes(1);
        expect(getReminderPrefs().enabled).toBe(true);
    });

    it('stays off after a denial and offers system settings', async () => {
        const s = scheduler('prompt', 'denied');
        registerReminderScheduler(s.impl);
        await mount();
        await click(toggle());
        expect(getReminderPrefs().enabled).toBe(false);
        expect(toggle()!.getAttribute('aria-checked')).toBe('false');
        expect(host.textContent).toContain('Notifications are blocked');

        const open = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Open settings');
        await click(open ?? null);
        expect(s.openSystemSettings).toHaveBeenCalledTimes(1);
    });

    it('does not ask again once the OS has already denied', async () => {
        const s = scheduler('denied');
        registerReminderScheduler(s.impl);
        await mount();
        await click(toggle());
        expect(s.requestPermission).not.toHaveBeenCalled();
        expect(host.textContent).toContain('Notifications are blocked');
    });

    it('turning off clears the denied message and hides the time picker', async () => {
        const s = scheduler('granted');
        registerReminderScheduler(s.impl);
        await mount();
        await click(toggle());
        await click(toggle());
        expect(getReminderPrefs().enabled).toBe(false);
        expect(host.querySelector('#notifications-daily-reminder-time')).toBeNull();
    });
});
