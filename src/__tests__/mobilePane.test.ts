/**
 * Mobile/tablet show one pane at a time. A tag filter (`/?tag=x`) has no folder
 * in the route but still needs the note list, not the sidebar.
 */
import { describe, it, expect } from 'vitest';
import { getMobilePane, showNewNoteFab } from '@/layouts/mobilePane';

describe('getMobilePane', () => {
    it('shows the sidebar at the root', () => {
        expect(getMobilePane({})).toBe('sidebar');
    });

    it('shows the note list for a tag filter', () => {
        expect(getMobilePane({ tag: 'a' })).toBe('list');
    });

    it('shows the note list for a folder', () => {
        expect(getMobilePane({ folderId: 'f' })).toBe('list');
    });

    it('shows the editor for a note', () => {
        expect(getMobilePane({ folderId: 'f', noteId: 'n' })).toBe('editor');
    });

    it('shows the editor for a note opened from a tag filter', () => {
        expect(getMobilePane({ tag: 'a', folderId: 'f', noteId: 'n' })).toBe('editor');
    });
});

describe('showNewNoteFab', () => {
    const base = {
        isPhone: true,
        pane: 'list' as const,
        isManagementView: false,
        isShared: false,
        overlayOpen: false,
        textFieldFocused: false,
    };

    it('shows on a phone on home and on a note list', () => {
        expect(showNewNoteFab({ ...base, pane: 'sidebar' })).toBe(true);
        expect(showNewNoteFab(base)).toBe(true);
    });

    it('hides on tablet and desktop, where the list header keeps New', () => {
        expect(showNewNoteFab({ ...base, isPhone: false })).toBe(false);
    });

    it('hides inside a note', () => {
        expect(showNewNoteFab({ ...base, pane: 'editor' })).toBe(false);
    });

    it('hides in Trash and Archive', () => {
        expect(showNewNoteFab({ ...base, isManagementView: true })).toBe(false);
    });

    it('hides on Shared, which lists other people\'s notes (#853)', () => {
        expect(showNewNoteFab({ ...base, isShared: true })).toBe(false);
    });

    it('hides while a sheet or dialog is open', () => {
        expect(showNewNoteFab({ ...base, overlayOpen: true })).toBe(false);
    });

    it('hides while a text field has focus (the keyboard is up)', () => {
        expect(showNewNoteFab({ ...base, textFieldFocused: true })).toBe(false);
    });
});
