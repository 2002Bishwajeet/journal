// @vitest-environment happy-dom
/**
 * Sign-out wipes the local database, then reloads. A COMMIT returns before PGlite
 * writes it to IndexedDB, so logout() must wait for that write before it navigates,
 * or the next identity sees the previous one's notes (#1060).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    calls: [] as string[],
    flush: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/lib/db', () => ({
    clearAllLocalData: vi.fn(async () => { mocks.calls.push('clear'); }),
    flushToIndexedDb: mocks.flush,
}));
vi.mock('@/hooks/auth/useVerifyToken', () => ({ useVerifyToken: () => ({ data: undefined, isFetchedAfterMount: false }) }));
vi.mock('@/hooks/useOnlineContext', () => ({ useOnlineContext: () => ({ isOnline: true }) }));
vi.mock('@/lib/homebase/WebPushProvider', () => ({ removeWebPush: vi.fn(async () => {}) }));
vi.mock('@/lib/yjs/unsavedEdits', () => ({ discardAllUnsavedEdits: vi.fn() }));

import { useAuth } from '@/hooks/auth/useAuth';

async function renderLogout() {
    let logout: (() => Promise<void>) | undefined;
    function Probe() {
        logout = useAuth().logout;
        return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(h(Probe)); });
    return { logout: logout!, unmount: () => act(async () => root.unmount()) };
}

describe('logout', () => {
    beforeEach(() => {
        mocks.calls.length = 0;
        mocks.flush.mockReset();
        vi.spyOn(window.location, 'replace').mockImplementation(() => { mocks.calls.push('navigate'); });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('waits for the wipe to be written to IndexedDB before it navigates', async () => {
        let finishFlush!: () => void;
        mocks.flush.mockImplementation(() => {
            mocks.calls.push('flush');
            return new Promise<void>((resolve) => { finishFlush = resolve; });
        });
        const { logout, unmount } = await renderLogout();

        const done = logout();
        await vi.waitFor(() => expect(mocks.calls).toContain('flush'));
        expect(mocks.calls).not.toContain('navigate');

        finishFlush();
        await done;
        expect(mocks.calls).toEqual(['clear', 'flush', 'navigate']);
        await unmount();
    });

    it('still navigates, and logs, when the flush fails', async () => {
        mocks.flush.mockRejectedValue(new Error('flush failed'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { logout, unmount } = await renderLogout();

        await logout();
        expect(mocks.calls).toEqual(['clear', 'navigate']);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[logout]'), expect.any(Error));
        await unmount();
    });
});
