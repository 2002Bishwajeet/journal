// @vitest-environment happy-dom
/**
 * /open-shared (#1002): a note this Journal has opens at once; a miss waits for the
 * first sync pass to end (a fresh device gets its notes then), looks again and pulls
 * from the owner; still nothing is "no access".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { entries, sync, pullOwnerNow } = vi.hoisted(() => ({
    entries: new Map<string, { metadata: { folderId: string } }>(),
    sync: { current: { lastSyncResult: null as object | null, syncStatus: 'syncing' } },
    pullOwnerNow: vi.fn(async () => {}),
}));
vi.mock('@/lib/db/queries', () => ({ getSearchIndexEntry: vi.fn(async (id: string) => entries.get(id) ?? null) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ ...sync.current, syncService: { pullOwnerNow } }) }));
vi.mock('@/hooks/useOnlineContext', () => ({ useOnlineContext: () => ({ isOnline: true }) }));

import { useOpenSharedNote } from '@/hooks/useOpenSharedNote';

const OWNER = 'owner.example.com';
const FILE = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';

function Probe() {
    const { noAccess } = useOpenSharedNote();
    return createElement('p', { 'data-testid': 'probe' }, noAccess ? 'no access' : 'opening');
}
function Where() {
    const location = useLocation();
    return createElement('p', { 'data-testid': 'probe' }, location.pathname);
}

let el: HTMLElement;
let root: Root;
const shown = () => el.querySelector('[data-testid="probe"]')?.textContent;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function render() {
    return act(async () => {
        root.render(createElement(MemoryRouter, { initialEntries: [`/open-shared?identity=${OWNER}&file=${FILE}`] },
            createElement(Routes, null,
                createElement(Route, { path: '/open-shared', element: createElement(Probe) }),
                createElement(Route, { path: '/:folderId/:noteId', element: createElement(Where) }),
            )));
    });
}

beforeEach(() => {
    entries.clear();
    sync.current = { lastSyncResult: null, syncStatus: 'syncing' };
    pullOwnerNow.mockReset();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

describe('useOpenSharedNote', () => {
    it('opens a note this Journal has without waiting for sync', async () => {
        entries.set(FILE, { metadata: { folderId: 'main' } });
        await render();
        await tick();

        expect(shown()).toBe(`/main/${FILE}`);
        expect(pullOwnerNow).not.toHaveBeenCalled();
    });

    it('on a miss waits for the first sync, then opens the note it brought', async () => {
        await render();
        await tick();
        expect(shown()).toBe('opening');
        expect(pullOwnerNow).not.toHaveBeenCalled();

        entries.set(FILE, { metadata: { folderId: 'main' } });
        sync.current = { lastSyncResult: {}, syncStatus: 'idle' };
        await render();
        await tick();

        expect(shown()).toBe(`/main/${FILE}`);
        expect(pullOwnerNow).not.toHaveBeenCalled();
    });

    it('after the first sync, pulls from the owner once and says no access when nothing came', async () => {
        await render();
        await tick();
        sync.current = { lastSyncResult: null, syncStatus: 'error' };
        await render();
        await tick();

        expect(pullOwnerNow).toHaveBeenCalledTimes(1);
        expect(pullOwnerNow).toHaveBeenCalledWith(OWNER);
        expect(shown()).toBe('no access');
    });
});
