// @vitest-environment happy-dom
/**
 * Open tabs are device-local UI state, so they persist to localStorage and never
 * to the app_state table: a PGlite write costs a full IndexedDB flush, and the
 * tab write was queued ahead of the note's content read on every tab open.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
    getAppState: vi.fn<(key: string) => Promise<unknown>>(async () => null),
    saveAppState: vi.fn<(key: string, value: unknown) => Promise<void>>(async () => { }),
}));
vi.mock('@/lib/db', () => mocks);

import { useTabManager } from '@/hooks/useTabManager';
import { TABS_STORAGE_KEY } from '@/lib/storage';

type TabApi = ReturnType<typeof useTabManager>;

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getAppState.mockResolvedValue(null);
});

async function mountTabManager() {
    let latest: TabApi | null = null;
    function Probe() {
        latest = useTabManager();
        return null;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(h(Probe)); });
    return {
        get api(): TabApi { return latest!; },
        act: (fn: () => void) => act(async () => { fn(); }),
        settle: () => act(async () => { await new Promise((r) => setTimeout(r, 0)); }),
        unmount: async () => { await act(async () => root.unmount()); el.remove(); },
    };
}

const storedTabs = () => JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) ?? 'null');

describe('useTabManager persistence', () => {
    it('saves opened tabs to localStorage without writing to the database', async () => {
        const t = await mountTabManager();

        await t.act(() => t.api.openTab('note-1', 'First'));

        expect(t.api.openTabs).toEqual([{ docId: 'note-1', title: 'First' }]);
        expect(t.api.activeTabId).toBe('note-1');
        expect(storedTabs()).toEqual({
            openTabs: [{ docId: 'note-1', title: 'First' }],
            activeTabId: 'note-1',
        });
        expect(mocks.saveAppState).not.toHaveBeenCalled();

        await t.unmount();
    });

    it('restores tabs from localStorage without reading the database', async () => {
        localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
            openTabs: [{ docId: 'note-2', title: 'Restored' }],
            activeTabId: 'note-2',
        }));

        const t = await mountTabManager();

        expect(t.api.openTabs.map((x) => x.docId)).toEqual(['note-2']);
        expect(t.api.activeTabId).toBe('note-2');
        expect(mocks.getAppState).not.toHaveBeenCalled();

        await t.unmount();
    });

    it('reads the legacy app_state row once, for tabs saved before the move', async () => {
        mocks.getAppState.mockResolvedValue({
            openTabs: [{ docId: 'note-3', title: 'Legacy' }],
            activeTabId: 'note-3',
        });

        const t = await mountTabManager();
        await t.settle();

        expect(mocks.getAppState).toHaveBeenCalledWith('open_tabs');
        expect(t.api.openTabs.map((x) => x.docId)).toEqual(['note-3']);
        // Adopted state is persisted, so the next boot reads localStorage.
        expect(storedTabs()).toEqual({
            openTabs: [{ docId: 'note-3', title: 'Legacy' }],
            activeTabId: 'note-3',
        });

        // The next tab change persists locally; nothing is written back to the DB.
        await t.act(() => t.api.openTab('note-4', 'New'));
        expect(storedTabs().activeTabId).toBe('note-4');
        expect(mocks.saveAppState).not.toHaveBeenCalled();

        await t.unmount();
    });

    it('does not clobber a tab opened while the legacy read is in flight', async () => {
        // The legacy read waits on the whole database boot — seconds on a
        // migrating launch — while the restored URL note opens immediately.
        let resolveLegacy: (value: unknown) => void = () => { };
        mocks.getAppState.mockImplementation(
            () => new Promise((resolve) => { resolveLegacy = resolve; }),
        );

        const t = await mountTabManager();
        await t.act(() => t.api.openTab('note-from-url', 'From URL'));

        resolveLegacy({ openTabs: [{ docId: 'legacy', title: 'Legacy' }], activeTabId: 'legacy' });
        await t.settle();

        // The open note survives, and state and localStorage stay in step.
        expect(mocks.getAppState).toHaveBeenCalledWith('open_tabs'); // the race really happened
        expect(t.api.openTabs.map((x) => x.docId)).toEqual(['note-from-url']);
        expect(t.api.activeTabId).toBe('note-from-url');
        expect(storedTabs()).toEqual({
            openTabs: [{ docId: 'note-from-url', title: 'From URL' }],
            activeTabId: 'note-from-url',
        });

        await t.unmount();
    });

    it('ignores a malformed legacy app_state row', async () => {
        mocks.getAppState.mockResolvedValue({ unexpected: 'shape' });

        const t = await mountTabManager();
        await t.settle();

        expect(t.api.openTabs).toEqual([]);
        expect(t.api.activeTabId).toBeNull();

        await t.unmount();
    });

    it('ignores unparseable stored tabs instead of crashing', async () => {
        localStorage.setItem(TABS_STORAGE_KEY, '{ not json');

        const t = await mountTabManager();

        expect(t.api.openTabs).toEqual([]);
        expect(t.api.activeTabId).toBeNull();

        await t.unmount();
    });
});
