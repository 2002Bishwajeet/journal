// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { settingsPlatform, isNativeSettings, isPhoneSettings, isAndroidPhone } from '@/lib/settingsPlatform';
import { sectionsFor } from '@/components/settings/sections';

const setNative = (platform?: 'macos' | 'windows' | 'linux' | 'ios' | 'android') => {
    window.__JOURNAL_NATIVE__ = platform ? { platform } : undefined;
};

afterEach(() => setNative());

const ids = (platform: Parameters<typeof sectionsFor>[0], hasReminder = false) =>
    sectionsFor(platform, hasReminder).map((s) => s.id);

describe('settingsPlatform', () => {
    it('maps the web by viewport', () => {
        expect(settingsPlatform(false)).toBe('web-desktop');
        expect(settingsPlatform(true)).toBe('web-phone');
    });

    it('maps the app by OS, whatever the viewport', () => {
        for (const p of ['ios', 'android'] as const) {
            setNative(p);
            expect(settingsPlatform(false)).toBe('native-phone');
            expect(settingsPlatform(true)).toBe('native-phone');
        }
        for (const p of ['macos', 'windows', 'linux'] as const) {
            setNative(p);
            expect(settingsPlatform(true)).toBe('native-desktop');
        }
    });

    it('classifies native and phone', () => {
        expect(isNativeSettings('native-phone')).toBe(true);
        expect(isNativeSettings('web-phone')).toBe(false);
        expect(isPhoneSettings('web-phone')).toBe(true);
        expect(isPhoneSettings('native-desktop')).toBe(false);
    });
});

describe('sectionsFor', () => {
    it('keeps every section on web desktop', () => {
        expect(ids('web-desktop')).toHaveLength(9);
    });

    it('drops AI and keyboard shortcuts on phones', () => {
        expect(ids('web-phone')).toEqual(['account', 'appearance', 'agent-access', 'notifications', 'data', 'about', 'diagnostics']);
    });

    it('lists notifications on the phone app only with a daily reminder (no web push there)', () => {
        expect(ids('native-phone')).toEqual(['account', 'appearance', 'agent-access', 'security', 'data', 'about', 'diagnostics']);
        expect(ids('native-phone', true)).toContain('notifications');
    });

    it('keeps notifications (desktop notifications), AI and shortcuts on native desktop', () => {
        const native = ids('native-desktop');
        expect(native).toContain('notifications');
        expect(native).toContain('ai');
        expect(native).toContain('shortcuts');
    });
});

describe('isAndroidPhone', () => {
    it('follows the app platform, else the browser', () => {
        setNative('android');
        expect(isAndroidPhone()).toBe(true);
        setNative('ios');
        expect(isAndroidPhone()).toBe(false);
        setNative();
        const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 15; Pixel 9)');
        expect(isAndroidPhone()).toBe(true);
        ua.mockRestore();
    });
});

describe('keyboard shortcut labels', () => {
    const firstKey = async () => {
        vi.resetModules();
        const { shortcutGroups } = await import('@/components/modals/KeyboardShortcutsModal');
        return shortcutGroups[0].shortcuts[0].keys[0];
    };

    it('shows ⌘ in the macOS app and Ctrl in the Windows and Linux apps, whatever navigator says', async () => {
        const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
        setNative('macos');
        expect(await firstKey()).toBe('⌘');
        platform.mockReturnValue('MacIntel');
        setNative('windows');
        expect(await firstKey()).toBe('Ctrl');
        setNative('linux');
        expect(await firstKey()).toBe('Ctrl');
        platform.mockRestore();
    });
});
