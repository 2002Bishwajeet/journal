/**
 * #913: the edge picks / (the app with the session hint cookie, else the landing page),
 * so the service worker sends a page load of / to the network first. Offline, or after
 * 3s without an answer, it falls back to the precached app shell, so the installed app
 * still opens fast.
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

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    matchPrecache.mockClear();
});

const root = () => {
    const request = new Request('https://journal.example/');
    return { request, url: new URL(request.url), event: {} as ExtendableEvent } as never;
};

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
        const options = root();
        const res = await handle(options);
        expect(await res.text()).toBe('from the edge');
        expect(fetch).toHaveBeenCalledWith((options as { request: Request }).request);
        expect(matchPrecache).not.toHaveBeenCalled();
    });

    it('offline, serves the precached app shell', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
        const res = await handle(root());
        expect(await res.text()).toBe('precached /');
        expect(matchPrecache).toHaveBeenCalledWith('/');
    });

    it('on a slow network, serves the precached app shell after 3s', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
        const res = handle(root());
        await vi.advanceTimersByTimeAsync(2999);
        expect(matchPrecache).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(await (await res).text()).toBe('precached /');
    });

    it('with no precached shell yet, waits for the slow network', async () => {
        vi.useFakeTimers();
        let answer!: (r: Response) => void;
        vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((r) => { answer = r; }));
        matchPrecache.mockResolvedValueOnce(undefined as never);
        const res = handle(root());
        await vi.advanceTimersByTimeAsync(3000);
        answer(new Response('late edge'));
        expect(await (await res).text()).toBe('late edge');
    });
});
