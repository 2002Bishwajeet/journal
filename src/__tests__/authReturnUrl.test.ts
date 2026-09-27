// @vitest-environment happy-dom
/**
 * Routing (#186): a signed-out deep link or PWA share-target request must survive
 * the sign-in round trip. AuthGuard carries the requested path+query+hash as a
 * `returnUrl` query param on the /welcome redirect; Landing reads it back and,
 * once authenticated, navigates there — running it through sanitizeReturnUrl so
 * an attacker-controlled returnUrl can't produce an open redirect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
    isAuthenticated: false,
    authenticationState: 'anonymous' as 'unknown' | 'anonymous' | 'authenticated',
}));

vi.mock('@/hooks/auth/useAuth', () => ({
    useAuth: () => ({
        isAuthenticated: mocks.isAuthenticated,
        authenticationState: mocks.authenticationState,
    }),
}));

import { AuthGuard } from '@/components/auth/AuthGuard';
import LandingPage from '@/pages/Landing';

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.isAuthenticated = false;
    mocks.authenticationState = 'anonymous';
});

function LandedProbe({ onLand }: { onLand: (href: string) => void }) {
    const location = useLocation();
    onLand(location.pathname + location.search);
    return null;
}

async function renderApp(
    initialEntry: string,
    routes: Array<{ path: string; element: ReturnType<typeof h> }>,
) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
        root.render(
            h(
                MemoryRouter,
                { initialEntries: [initialEntry] },
                h(
                    Routes,
                    null,
                    ...routes.map((r) => h(Route, { key: r.path, path: r.path, element: r.element })),
                ),
            ),
        );
    });
    return {
        unmount: async () => {
            await act(async () => root.unmount());
            el.remove();
        },
    };
}

describe('AuthGuard returnUrl redirect', () => {
    it('redirects to /welcome with the requested path+query+hash as returnUrl', async () => {
        let landedAt = '';
        const app = await renderApp('/f1/n1?tag=x#h', [
            { path: '/*', element: h(AuthGuard, null, h('div', null, 'protected')) },
            { path: '/welcome', element: h(LandedProbe, { onLand: (href: string) => { landedAt = href; } }) },
        ]);

        expect(landedAt).toBe('/welcome?returnUrl=%2Ff1%2Fn1%3Ftag%3Dx%23h');

        await app.unmount();
    });

    it('omits returnUrl when the requested target is exactly /', async () => {
        let landedAt = '';
        const app = await renderApp('/', [
            { path: '/*', element: h(AuthGuard, null, h('div', null, 'protected')) },
            { path: '/welcome', element: h(LandedProbe, { onLand: (href: string) => { landedAt = href; } }) },
        ]);

        expect(landedAt).toBe('/welcome');

        await app.unmount();
    });
});

describe('Landing authenticated redirect', () => {
    beforeEach(() => {
        mocks.isAuthenticated = true;
        mocks.authenticationState = 'authenticated';
    });

    it('replaces to a safe same-origin returnUrl', async () => {
        let landedAt = '';
        const app = await renderApp('/welcome?returnUrl=%2Ff1%2Fn1', [
            { path: '/welcome', element: h(LandingPage) },
            { path: '/*', element: h(LandedProbe, { onLand: (href: string) => { landedAt = href; } }) },
        ]);

        expect(landedAt).toBe('/f1/n1');

        await app.unmount();
    });

    it('rejects an off-origin returnUrl and replaces to /', async () => {
        let landedAt = '';
        const app = await renderApp('/welcome?returnUrl=https%3A%2F%2Fevil.example', [
            { path: '/welcome', element: h(LandingPage) },
            { path: '/*', element: h(LandedProbe, { onLand: (href: string) => { landedAt = href; } }) },
        ]);

        expect(landedAt).toBe('/');

        await app.unmount();
    });

    it('rejects a protocol-relative returnUrl and replaces to /', async () => {
        let landedAt = '';
        const app = await renderApp('/welcome?returnUrl=%2F%2Fevil.example', [
            { path: '/welcome', element: h(LandingPage) },
            { path: '/*', element: h(LandedProbe, { onLand: (href: string) => { landedAt = href; } }) },
        ]);

        expect(landedAt).toBe('/');

        await app.unmount();
    });
});
