import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS } from '@/components/settings/sections';

describe('SETTINGS_SECTIONS', () => {
    it('has unique ids', () => {
        const ids = SETTINGS_SECTIONS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('opens on the account section', () => {
        expect(SETTINGS_SECTIONS[0].id).toBe('account');
    });

    it('is in the order account, appearance, ai, voice, agent-access, notifications, security, data, license, shortcuts, about, diagnostics', () => {
        expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
            'account',
            'appearance',
            'ai',
            'voice',
            'agent-access',
            'notifications',
            'security',
            'data',
            'license',
            'shortcuts',
            'about',
            'diagnostics',
        ]);
    });

    it('puts shortcuts immediately before about, and diagnostics last', () => {
        const ids = SETTINGS_SECTIONS.map((s) => s.id);
        expect(ids[ids.length - 1]).toBe('diagnostics');
        expect(ids[ids.indexOf('about') - 1]).toBe('shortcuts');
    });

    it('lists License only in the native app of a build with a billing Worker', () => {
        expect(SETTINGS_SECTIONS.find((s) => s.id === 'license')?.hidden).toBe(true);
    });

    it('hides the shortcuts section on phones', () => {
        const shortcuts = SETTINGS_SECTIONS.find((s) => s.id === 'shortcuts');
        expect(shortcuts?.platforms).toEqual(['web-desktop', 'native-desktop']);
    });

    it('shows the security section only in the native app', () => {
        expect(SETTINGS_SECTIONS.find((s) => s.id === 'security')?.platforms).toEqual(['native-phone', 'native-desktop']);
    });

    it('shows Voice notes only in the native app', () => {
        expect(SETTINGS_SECTIONS.find((s) => s.id === 'voice')?.platforms).toEqual(['native-phone', 'native-desktop']);
    });
});
