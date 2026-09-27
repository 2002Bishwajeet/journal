/**
 * Mobile/tablet show one pane at a time. A tag filter (`/?tag=x`) has no folder
 * in the route but still needs the note list, not the sidebar.
 */
import { describe, it, expect } from 'vitest';
import { getMobilePane } from '@/layouts/mobilePane';

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
