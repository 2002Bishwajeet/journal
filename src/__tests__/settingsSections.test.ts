import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS } from '@/components/settings/sections';

describe('SETTINGS_SECTIONS', () => {
    it('has unique ids', () => {
        const ids = SETTINGS_SECTIONS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('is in the order appearance, ai, agent-access, data, shortcuts, about', () => {
        expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
            'appearance',
            'ai',
            'agent-access',
            'data',
            'shortcuts',
            'about',
        ]);
    });

    it('puts shortcuts immediately before about, and about last', () => {
        const ids = SETTINGS_SECTIONS.map((s) => s.id);
        expect(ids[ids.length - 1]).toBe('about');
        expect(ids[ids.indexOf('about') - 1]).toBe('shortcuts');
    });

    it('hides the shortcuts section on phones', () => {
        const shortcuts = SETTINGS_SECTIONS.find((s) => s.id === 'shortcuts');
        expect(shortcuts?.desktopOnly).toBe(true);
    });
});
