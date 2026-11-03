/**
 * #913: the edge picks / (the app with the session hint cookie, else the landing page),
 * so the service worker sends a page load of / to the network first. Offline it falls
 * back to the precached app shell, so the installed app still opens.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import type { RouteHandlerCallback, RouteMatchCallback } from 'workbox-core';

const { calls, matchPrecache } = vi.hoisted(() => ({
    calls: [] as unknown[][],
    matchPrecache: vi.fn(async (url: string) => new Response(`precached ${url}`)),
}));

vi.mock('workbox-precaching', () => ({
    precacheAndRoute: vi.fn(() => calls.push(['precache'])),
    cleanupOutdatedCaches: vi.fn(),
    createHandlerBoundToURL: vi.fn(() => () => new Response('shell')),
    matchPrecache,
}));

vi.mock('workbox-routing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('workbox-routing')>()),
    registerRoute: vi.fn((...args: unknown[]) => calls.push(args)),
}));

let match: RouteMatchCallback;
let handle: RouteHandlerCallback;

beforeAll(async () => {
    vi.stubGlobal('self', { __WB_MANIFEST: [], addEventListener: vi.fn(), location: new URL('https://journal.example/sw.js') });
    await import('@/sw');
    const precacheAt = calls.findIndex((c) => c[0] === 'precache');
    // The first route: it must come before the precache route, which would answer '/' itself.
    [match, handle] = calls[0] as [RouteMatchCallback, RouteHandlerCallback];
    expect(precacheAt).toBe(1);
});

afterEach(() => vi.restoreAllMocks());

function matches(path: string, mode: RequestMode = 'navigate') {
    const url = new URL(path, 'https://journal.example');
    return Boolean(match({ url, request: { mode } as Request, event: {} as ExtendableEvent, sameOrigin: true }));
}

describe('service worker: a page load of /', () => {
    it('is the only navigation this route takes', () => {
        expect(matches('/')).toBe(true);
        expect(matches('/?action=new')).toBe(true);
        expect(matches('/welcome')).toBe(false);
        expect(matches('/share/alice.example/abc')).toBe(false);
        expect(matches('/', 'cors')).toBe(false);
        expect(matches('https://other.example/')).toBe(false);
    });

    it('goes to the network, so the edge decides', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('from the edge'));
        const request = new Request('https://journal.example/');
        const res = await handle({ request, url: new URL(request.url), event: {} as ExtendableEvent } as never);
        expect(await res.text()).toBe('from the edge');
        expect(fetch).toHaveBeenCalledWith(request);
    });

    it('offline, serves the precached app shell', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
        const request = new Request('https://journal.example/');
        const res = await handle({ request, url: new URL(request.url), event: {} as ExtendableEvent } as never);
        expect(await res.text()).toBe('precached /');
        expect(matchPrecache).toHaveBeenCalledWith('/');
    });
});
