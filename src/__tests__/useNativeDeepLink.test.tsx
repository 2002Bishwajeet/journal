// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const plugin = vi.hoisted(() => ({
    current: null as string[] | null,
    handler: null as ((urls: string[]) => void) | null,
}));

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    getCurrent: vi.fn(async () => plugin.current),
    onOpenUrl: vi.fn(async (cb: (urls: string[]) => void) => {
        plugin.handler = cb;
        return () => {
            plugin.handler = null;
        };
    }),
}));

const late = vi.hoisted(() => ({ calls: 0 }));

vi.mock('@/lib/db', () => ({
    getDatabase: async () => ({
        query: async (_sql: string, [id]: string[]) => ({
            rows:
                id === '0b9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10' || (id === '2d9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10' && ++late.calls > 3)
                    ? [{ folder_id: 'work' }]
                    : [],
        }),
    }),
}));

import { useNativeDeepLink } from '@/hooks/useNativeDeepLink';
import { MAIN_FOLDER_ID } from '@/lib/homebase';

const ID = '0b9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10';
const OTHER = '1c9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10';

let root: Root;
let seen = '/';
const authState = vi.hoisted(() => ({ signedIn: true }));

vi.mock('@/hooks/auth/useAuth', () => ({
    useAuth: () => ({
        isAuthenticated: authState.signedIn,
        authenticationState: authState.signedIn ? 'authenticated' : 'unauthenticated',
    }),
}));

// CanEditReporter loads @premium's useEntitlement (react-query) when native/ is checked out.
vi.mock('@/components/license/License', () => ({ CanEditReporter: () => null }));

import { AuthGuard } from '@/components/auth/AuthGuard';

function Probe() {
    useNativeDeepLink();
    const { pathname, search } = useLocation();
    useEffect(() => {
        seen = pathname + search;
    }, [pathname, search]);
    return null;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

async function mount() {
    root = createRoot(document.createElement('div'));
    await act(async () => {
        root.render(
            <MemoryRouter>
                <Probe />
                <Routes>
                    <Route path="/welcome" element={<span />} />
                    <Route path="*" element={<AuthGuard><span /></AuthGuard>} />
                </Routes>
            </MemoryRouter>,
        );
    });
    await flush();
}

const waitFor = async (check: () => void) => {
    for (let i = 0; i < 50; i++) {
        try {
            check();
            return;
        } catch {
            await flush();
        }
    }
    check();
};
const result = { get current() { return seen; } };

describe('useNativeDeepLink', () => {
    beforeEach(() => {
        plugin.current = null;
        plugin.handler = null;
        sessionStorage.clear();
        authState.signedIn = true;
        seen = '/';
        window.__JOURNAL_NATIVE__ = { platform: 'macos' };
    });
    afterEach(async () => {
        await act(async () => { root?.unmount(); });
        delete window.__JOURNAL_NATIVE__;
    });

    it('routes a cold-start note link to the note in its folder', async () => {
        plugin.current = [`journal://note/${ID}`];
        await mount();
        await waitFor(() => expect(result.current).toBe(`/work/${ID}`));
    });

    it('sends a note that is not on this device to Main, where the editor says "Note not found"', async () => {
        plugin.current = [`journal://note/${OTHER}`];
        await mount();
        await new Promise((r) => setTimeout(r, 3500));
        await waitFor(() => expect(result.current).toBe(`/${MAIN_FOLDER_ID}/${OTHER}`));
    });

    it('waits briefly for a note that is still syncing in, then opens it in its folder', async () => {
        late.calls = 0;
        plugin.current = ['journal://note/2d9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10'];
        await mount();
        await new Promise((r) => setTimeout(r, 1000));
        await waitFor(() => expect(result.current).toBe('/work/2d9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10'));
    });

    it('routes link events while running', async () => {
        await mount();
        await waitFor(() => expect(plugin.handler).not.toBeNull());
        plugin.handler!(['journal://today']);
        await waitFor(() => expect(result.current).toBe('/?action=today'));
        plugin.handler!(['journal://new?title=T&text=hello']);
        await waitFor(() => expect(result.current).toBe('/share-target?title=T&text=hello'));
        plugin.handler!(['journal://search?q=trip']);
        await waitFor(() => expect(result.current).toBe('/?action=search&q=trip'));
    });

    it('ignores links that fail the parser', async () => {
        plugin.current = ['journal://note/../../x'];
        await mount();
        await waitFor(() => expect(plugin.handler).not.toBeNull());
        plugin.handler!(['journal://delete?id=1', 'https://evil.example/']);
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current).toBe('/');
    });

    it('does not follow the launch link again after a reload', async () => {
        plugin.current = ['journal://today'];
        await mount();
        await waitFor(() => expect(result.current).toBe('/?action=today'));
        await act(async () => { root.unmount(); });
        await mount();
        await waitFor(() => expect(plugin.handler).not.toBeNull());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current).toBe('/');
    });

    it('keeps the link for sign-in: signed out, the guard sends it as the return URL', async () => {
        authState.signedIn = false;
        plugin.current = ['journal://new?title=T&text=hello'];
        await mount();
        await waitFor(() => expect(result.current).toBe('/welcome?returnUrl=%2Fshare-target%3Ftitle%3DT%26text%3Dhello'));
    });

    it('does nothing outside the native app', async () => {
        delete window.__JOURNAL_NATIVE__;
        plugin.current = ['journal://today'];
        await mount();
        await new Promise((r) => setTimeout(r, 20));
        expect(plugin.handler).toBeNull();
        expect(result.current).toBe('/');
    });
});
