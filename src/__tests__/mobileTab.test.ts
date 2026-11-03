/** The phone's bottom tab bar (#853): which route tab a location belongs to. */
import { describe, it, expect } from 'vitest';
import { getMobileTab } from '@/layouts/mobileTab';

describe('getMobileTab', () => {
    it('is Notes on home, a folder, a tag list and a note', () => {
        expect(getMobileTab('/')).toBe('notes');
        expect(getMobileTab('/projects')).toBe('notes');
        expect(getMobileTab('/projects/note-1')).toBe('notes');
    });

    it('is Shared on /shared and on a shared note', () => {
        expect(getMobileTab('/shared')).toBe('shared');
        expect(getMobileTab('/shared/note-1')).toBe('shared');
    });

    it('keeps Trash and Archive under Notes', () => {
        expect(getMobileTab('/trash')).toBe('notes');
        expect(getMobileTab('/archive')).toBe('notes');
    });

    it('does not mistake a folder that starts with "shared" for Shared', () => {
        expect(getMobileTab('/shared-trips')).toBe('notes');
    });
});
