/**
 * #515: an author's public index (/share/<identity>) and sitemap are rendered by
 * the share Pages Function. The service worker's SPA navigation fallback must
 * not answer those navigations with the precached shell, or a returning visitor
 * never reaches the function. Note pages still get the shell.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { NavigationRoute } from 'workbox-routing';

const routes: unknown[] = [];

vi.mock('workbox-precaching', () => ({
    precacheAndRoute: vi.fn(),
    cleanupOutdatedCaches: vi.fn(),
    createHandlerBoundToURL: vi.fn(() => () => new Response('shell')),
}));

vi.mock('workbox-routing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('workbox-routing')>()),
    registerRoute: vi.fn((route: unknown) => routes.push(route)),
}));

let navigationRoute: NavigationRoute;

beforeAll(async () => {
    vi.stubGlobal('self', { __WB_MANIFEST: [], addEventListener: vi.fn() });
    const { NavigationRoute } = await import('workbox-routing');
    await import('@/sw');
    navigationRoute = routes.find((r): r is NavigationRoute => r instanceof NavigationRoute)!;
});

function servesShell(path: string): boolean {
    const url = new URL(path, 'https://journal.example');
    return Boolean(navigationRoute.match({
        url,
        request: { mode: 'navigate' } as Request,
        event: {} as ExtendableEvent,
        sameOrigin: true,
    }));
}

describe('service worker navigation fallback', () => {
    it.each([
        '/share/alice.example',
        '/share/alice.example/',
        '/share/alice.example?ref=note',
        '/share/alice.example/sitemap.xml',
    ])('lets %s reach the network (author index / sitemap)', (path) => {
        expect(servesShell(path)).toBe(false);
    });

    it.each([
        '/',
        '/share/alice.example/0d8f6f3e-1b2c-4d5e-8f90-123456789abc',
        '/notes/abc',
    ])('still serves the SPA shell for %s', (path) => {
        expect(servesShell(path)).toBe(true);
    });
});
