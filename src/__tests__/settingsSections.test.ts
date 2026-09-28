import { describe, it, expect } from 'vitest';
import { SETTINGS_SECTIONS } from '@/components/settings/sections';

describe('SETTINGS_SECTIONS', () => {
    it('has unique ids', () => {
        const ids = SETTINGS_SECTIONS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('is in the order appearance, ai, data, about', () => {
        expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
            'appearance',
            'ai',
            'data',
            'about',
        ]);
    });
});
