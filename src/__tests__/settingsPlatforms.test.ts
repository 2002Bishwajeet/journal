// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { settingsPlatform, isNativeSettings, isPhoneSettings } from '@/lib/settingsPlatform';
import { sectionsFor } from '@/components/settings/sections';

const setNative = (platform?: 'macos' | 'windows' | 'linux' | 'ios' | 'android') => {
    window.__JOURNAL_NATIVE__ = platform ? { platform } : undefined;
};

afterEach(() => setNative());

const ids = (platform: Parameters<typeof sectionsFor>[0]) => sectionsFor(platform).map((s) => s.id);

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

    it('drops AI and keyboard shortcuts on phones, notifications in the app', () => {
        expect(ids('web-phone')).toEqual(['account', 'appearance', 'agent-access', 'notifications', 'data', 'about', 'diagnostics']);
        expect(ids('native-phone')).toEqual(['account', 'appearance', 'agent-access', 'data', 'about', 'diagnostics']);
    });

    it('drops notifications on native desktop but keeps AI and shortcuts', () => {
        const native = ids('native-desktop');
        expect(native).not.toContain('notifications');
        expect(native).toContain('ai');
        expect(native).toContain('shortcuts');
    });
});
