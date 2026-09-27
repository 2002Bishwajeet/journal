// @vitest-environment happy-dom
/**
 * A note created from Shared/Trash/Archive, or from any unknown/remotely-deleted
 * folder id in the URL, must land in a real folder (the current one if it
 * exists, otherwise Main) instead of a pseudo-folder id that no note list
 * query recognizes. And a folder-only URL whose folder doesn't exist should
 * redirect to `/` instead of rendering an empty "Notes" folder. See #185.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { resolveNoteFolderId } from '@/hooks/useFolders';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { COLLABORATIVE_FOLDER_ID } from '@/lib/homebase/config';

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

// The redirect guard added to JournalLayout (after its isNotesLoading ||
// isFolderLoading early return) can't be exercised by mounting JournalLayout
// itself here — it pulls in the full app's hooks (sync, tabs, auth, editor
// prefetch, etc.), which is what the manual QA steps in #185 cover instead.
// This mirrors that guard's predicate exactly to pin the routing decision on
// real react-router-dom (MemoryRouter + Navigate), independent of the rest of
// the layout.
function RouteGuard({ folders }: { folders: ReadonlyArray<{ id: string }> }) {
    const { folderId, noteId } = useParams();
    if (
        folderId &&
        !noteId &&
        folderId !== 'trash' &&
        folderId !== 'archive' &&
        folderId !== 'shared' &&
        folderId !== COLLABORATIVE_FOLDER_ID &&
        !folders.some((f) => f.id === folderId)
    ) {
        return h(Navigate, { to: '/', replace: true });
    }
    return h('div', { 'data-testid': 'landed' }, `${folderId ?? ''}/${noteId ?? ''}`);
}

async function renderAt(initialPath: string, folders: ReadonlyArray<{ id: string }>) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
        root.render(
            h(
                MemoryRouter,
                { initialEntries: [initialPath] },
                h(
                    Routes,
                    null,
                    h(Route, { path: '/', element: h('div', { 'data-testid': 'landed' }, 'root') }),
                    h(Route, { path: '/:folderId', element: h(RouteGuard, { folders }) }),
                    h(Route, { path: '/:folderId/:noteId', element: h(RouteGuard, { folders }) }),
                ),
            ),
        );
    });
    const landed = el.querySelector('[data-testid="landed"]')?.textContent ?? null;
    await act(async () => root.unmount());
    el.remove();
    return landed;
}

describe('JournalLayout unknown-folder redirect guard', () => {
    const folders = [{ id: 'real-folder' }];

    it('redirects an unknown folder-only route to root', async () => {
        expect(await renderAt('/does-not-exist', folders)).toBe('root');
    });

    it('does not redirect a real folder', async () => {
        expect(await renderAt('/real-folder', folders)).toBe('real-folder/');
    });

    it.each(['trash', 'archive', 'shared'])('does not redirect the %s pseudo-folder', async (id) => {
        expect(await renderAt(`/${id}`, folders)).toBe(`${id}/`);
    });

    it('does not redirect the collaborative folder id', async () => {
        expect(await renderAt(`/${COLLABORATIVE_FOLDER_ID}`, folders)).toBe(`${COLLABORATIVE_FOLDER_ID}/`);
    });

    it('does not redirect a note route even with an unknown folder id (peer notes)', async () => {
        expect(await renderAt('/unknown-folder/some-note', folders)).toBe('unknown-folder/some-note');
    });
});
