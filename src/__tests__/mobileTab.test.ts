/**
 * The phone's bottom tab bar (#853): which route tab is active, and where a tab
 * returns to after the user visited the other one.
 */
import { describe, it, expect } from 'vitest';
import { createTabMemory, getMobileTab } from '@/layouts/mobileTab';

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

describe('createTabMemory', () => {
    it('starts at each tab root', () => {
        const memory = createTabMemory();
        expect(memory.last('notes')).toBe('/');
        expect(memory.last('shared')).toBe('/shared');
    });

    it('returns the last Notes location after a visit to Shared', () => {
        const memory = createTabMemory();
        memory.visit('/projects', '');
        memory.visit('/shared', '');
        expect(memory.last('notes')).toBe('/projects');
        expect(memory.last('shared')).toBe('/shared');
    });

    it('keeps the tag of a tag list', () => {
        const memory = createTabMemory();
        memory.visit('/', '?tag=work');
        memory.visit('/shared', '');
        expect(memory.last('notes')).toBe('/?tag=work');
    });

    it('does not keep a note, which hides the bar', () => {
        const memory = createTabMemory();
        memory.visit('/projects', '');
        memory.visit('/projects/note-1', '');
        memory.visit('/shared/note-2', '');
        expect(memory.last('notes')).toBe('/projects');
        expect(memory.last('shared')).toBe('/shared');
    });
});
