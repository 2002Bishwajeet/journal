// @vitest-environment happy-dom
/** #1093: ?action=today opens today's note once; ?action=search&q= opens the search with the query. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { useLayoutUrlActions } from '@/hooks/useLayoutUrlActions';
import { setCanEdit, useCanEditAnswer } from '@/hooks/useCanEdit';

let root: Root;

async function mount(url: string, openSearch = vi.fn(), openToday = vi.fn(async () => {})) {
    function Probe() {
        useLayoutUrlActions({
            folders: [],
            isFolderLoading: false,
            folderId: undefined,
            notes: [],
            createNote: vi.fn(),
            openSearch,
            openToday,
            canEdit: useCanEditAnswer(),
            openCollaborate: vi.fn(),
        });
        return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => {
        root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Probe)));
    });
    return { openSearch, openToday };
}

afterEach(async () => {
    await act(async () => root.unmount());
    setCanEdit(true);
});

describe('useLayoutUrlActions deep link actions', () => {
    it('opens today once', async () => {
        const { openToday } = await mount('/?action=today');
        expect(openToday).toHaveBeenCalledTimes(1);
    });

    it('waits for the entitlement before opening today (#1176)', async () => {
        setCanEdit(undefined);
        const { openToday } = await mount('/?action=today');
        expect(openToday).not.toHaveBeenCalled();
        await act(async () => setCanEdit(false));
        expect(openToday).toHaveBeenCalledTimes(1);
    });

    it('opens the search with the query', async () => {
        const { openSearch } = await mount('/?action=search&q=trip');
        expect(openSearch).toHaveBeenCalledWith(true, 'trip');
    });

    it('opens an empty search without a query', async () => {
        const { openSearch } = await mount('/?action=search');
        expect(openSearch).toHaveBeenCalledWith(true);
    });
});
