// @vitest-environment happy-dom
/** #1016: OS notification in the hidden desktop app, the in-app toast everywhere else. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { notifyDesktop, toast } = vi.hoisted(() => ({
    notifyDesktop: vi.fn<(title: string, body: string) => Promise<boolean>>(async () => true),
    toast: vi.fn(),
}));

vi.mock('@premium', () => ({ notifyDesktop }));
vi.mock('sonner', () => ({ toast }));

import { notifyNative, setDesktopNotificationsOn, desktopNotificationsOn } from '@/lib/notifyNative';

type NativeWindow = { __JOURNAL_NATIVE__?: { platform: string } };
const setNative = (platform?: string) => {
    if (platform) (window as NativeWindow).__JOURNAL_NATIVE__ = { platform };
    else delete (window as NativeWindow).__JOURNAL_NATIVE__;
};
const setFocused = (focused: boolean) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
};

beforeEach(() => {
    notifyDesktop.mockClear();
    notifyDesktop.mockResolvedValue(true);
    toast.mockClear();
    localStorage.clear();
});

afterEach(() => {
    setNative();
    vi.restoreAllMocks();
});

describe('notifyNative', () => {
    it('shows an OS notification in the desktop app when the window is unfocused', async () => {
        setNative('linux');
        setFocused(false);
        await notifyNative('Ann shared "Plan" with you', '', '/');
        expect(notifyDesktop).toHaveBeenCalledWith('Ann shared "Plan" with you', '');
        expect(toast).not.toHaveBeenCalled();
    });

    it('shows a toast when the desktop window is focused', async () => {
        setNative('macos');
        setFocused(true);
        await notifyNative('Ann shared "Plan" with you', '', '/');
        expect(notifyDesktop).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith('Ann shared "Plan" with you');
    });

    it('shows a toast on the web even when unfocused', async () => {
        setFocused(false);
        await notifyNative('Ann shared "Plan" with you', '', '/');
        expect(notifyDesktop).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledTimes(1);
    });

    it('shows a toast on a phone app, which has no desktop notifications', async () => {
        setNative('ios');
        setFocused(false);
        await notifyNative('Ann shared "Plan" with you', '', '/');
        expect(notifyDesktop).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledTimes(1);
    });

    it('shows only a toast when the setting is off', async () => {
        setNative('windows');
        setFocused(false);
        setDesktopNotificationsOn(false);
        await notifyNative('Ann shared "Plan" with you', '', '/');
        expect(notifyDesktop).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledTimes(1);
    });

    it('falls back to the toast when the OS permission is denied', async () => {
        setNative('windows');
        setFocused(false);
        notifyDesktop.mockResolvedValue(false);
        await notifyNative('Title', 'Body', '/');
        expect(toast).toHaveBeenCalledWith('Title: Body');
    });

    it('falls back to the toast when the notification call fails', async () => {
        setNative('linux');
        setFocused(false);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        notifyDesktop.mockRejectedValue(new Error('no permission'));
        await notifyNative('Title', '', '/');
        expect(toast).toHaveBeenCalledWith('Title');
    });

    it('is on by default and remembers the setting', () => {
        expect(desktopNotificationsOn()).toBe(true);
        setDesktopNotificationsOn(false);
        expect(desktopNotificationsOn()).toBe(false);
        setDesktopNotificationsOn(true);
        expect(desktopNotificationsOn()).toBe(true);
    });
});
