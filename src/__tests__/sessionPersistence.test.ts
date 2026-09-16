// @vitest-environment happy-dom
/**
 * Session state (last note/folder, scroll positions) is device-local UI state
 * kept in localStorage. The app_state row is only read for sessions saved before
 * that move — and that read waits on the whole database boot, so it must never
 * overwrite where the user has navigated to in the meantime.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
    getAppState: vi.fn<(key: string) => Promise<unknown>>(async () => null),
    navigate: vi.fn(),
    location: { pathname: '/' } as { pathname: string },
}));
vi.mock('@/lib/db', () => ({ getAppState: mocks.getAppState }));
vi.mock('react-router-dom', () => ({
    useLocation: () => mocks.location,
    useNavigate: () => mocks.navigate,
}));

import { useSessionPersistence } from '@/hooks/useSessionPersistence';
import { SESSION_STORAGE_KEY } from '@/lib/storage';

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.clearAllMocks();
    mocks.getAppState.mockResolvedValue(null);
    mocks.location = { pathname: '/' };
});

function Probe() {
    useSessionPersistence();
    return null;
}

async function mountSession() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(h(Probe)); });
    return {
        // The save is debounced by 500ms.
        settle: (ms = 700) => act(async () => { await new Promise((r) => setTimeout(r, ms)); }),
        unmount: async () => { await act(async () => root.unmount()); el.remove(); },
    };
}

const storedSession = () => JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null');

describe('useSessionPersistence', () => {
    it('does not overwrite the current note when the legacy read resolves late', async () => {
        let resolveLegacy: (value: unknown) => void = () => { };
        mocks.getAppState.mockImplementation(
            () => new Promise((resolve) => { resolveLegacy = resolve; }),
        );
        mocks.location = { pathname: '/folder-1/note-1' };

        const s = await mountSession();

        // The database finally answers, long after the user opened note-1.
        resolveLegacy({
            lastFolderId: 'old-folder',
            lastNoteId: 'old-note',
            scrollPositions: {},
            sidebarCollapsed: false,
        });
        await s.settle();

        expect(mocks.getAppState).toHaveBeenCalledWith('session_state'); // the race really happened
        expect(storedSession()).toMatchObject({
            lastFolderId: 'folder-1',
            lastNoteId: 'note-1',
        });

        await s.unmount();
    });

    it('adopts and persists the legacy session when nothing has been navigated to', async () => {
        mocks.getAppState.mockResolvedValue({
            lastFolderId: 'folder-9',
            lastNoteId: 'note-9',
            scrollPositions: { 'note-9': 42 },
            sidebarCollapsed: true,
        });

        const s = await mountSession();
        await s.settle(300);

        expect(storedSession()).toMatchObject({
            lastFolderId: 'folder-9',
            lastNoteId: 'note-9',
            scrollPositions: { 'note-9': 42 },
            sidebarCollapsed: true,
        });

        await s.unmount();
    });

    it('reads localStorage instead of the database once a session is stored', async () => {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
            lastFolderId: 'folder-2',
            lastNoteId: 'note-2',
            scrollPositions: {},
            sidebarCollapsed: false,
        }));
        mocks.location = { pathname: '/folder-2/note-2' };

        const s = await mountSession();
        await s.settle();

        expect(mocks.getAppState).not.toHaveBeenCalled();

        await s.unmount();
    });
});
