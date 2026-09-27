/**
 * A note created from Shared/Trash/Archive, or from any unknown/remotely-deleted
 * folder id in the URL, must land in a real folder (the current one if it
 * exists, otherwise Main) instead of a pseudo-folder id that no note list
 * query recognizes. And a folder-only URL whose folder doesn't exist should
 * redirect to `/` instead of rendering an empty "Notes" folder. See #185.
 */
import { describe, it, expect } from 'vitest';
import { resolveNoteFolderId, isUnknownFolderRoute } from '@/hooks/useFolders';
import { MAIN_FOLDER_ID, COLLABORATIVE_FOLDER_ID } from '@/lib/homebase';

describe('resolveNoteFolderId', () => {
    const folders = [{ id: 'a' }];

    it('falls back to Main for the Shared pseudo-folder', () => {
        expect(resolveNoteFolderId('shared', [])).toBe(MAIN_FOLDER_ID);
    });

    it('falls back to Main for the Trash pseudo-folder', () => {
        expect(resolveNoteFolderId('trash', folders)).toBe(MAIN_FOLDER_ID);
    });

    it('falls back to Main for the Archive pseudo-folder', () => {
        expect(resolveNoteFolderId('archive', folders)).toBe(MAIN_FOLDER_ID);
    });

    it('falls back to Main for an unknown folder id', () => {
        expect(resolveNoteFolderId('nope', folders)).toBe(MAIN_FOLDER_ID);
    });

    it('falls back to Main when no folder id is given', () => {
        expect(resolveNoteFolderId(undefined, folders)).toBe(MAIN_FOLDER_ID);
    });

    it('returns the folder id when it exists', () => {
        expect(resolveNoteFolderId('a', folders)).toBe('a');
    });
});

describe('isUnknownFolderRoute', () => {
    const folders = [{ id: 'real-folder' }];

    it('flags an unknown folder-only route', () => {
        expect(isUnknownFolderRoute('does-not-exist', undefined, folders)).toBe(true);
    });

    it('does not flag a real folder', () => {
        expect(isUnknownFolderRoute('real-folder', undefined, folders)).toBe(false);
    });

    it.each(['trash', 'archive', 'shared'])('does not flag the %s pseudo-folder', (id) => {
        expect(isUnknownFolderRoute(id, undefined, [])).toBe(false);
    });

    it('does not flag the collaborative folder id', () => {
        expect(isUnknownFolderRoute(COLLABORATIVE_FOLDER_ID, undefined, [])).toBe(false);
    });

    it('does not flag a note route even with an unknown folder id (peer notes)', () => {
        expect(isUnknownFolderRoute('unknown-folder', 'some-note', folders)).toBe(false);
    });

    it('does not flag the root route', () => {
        expect(isUnknownFolderRoute(undefined, undefined, [])).toBe(false);
    });
});
