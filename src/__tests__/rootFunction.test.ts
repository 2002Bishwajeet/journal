/**
 * functions/index.ts (#913): / serves the app with the journal_session cookie and the
 * landing page to a request for HTML without it. The service worker's precache fetch of
 * '/' (Accept: *\/*) always gets the app's shell.
 */
import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/index';
import type { ShareContext } from '../../functions/_lib/types';

function call(headers: Record<string, string>, method = 'GET') {
    const fetched: string[] = [];
    const context: ShareContext = {
        request: new Request('https://journal.example/', { method, headers }),
        env: {
            ASSETS: {
                fetch: async (input) => {
                    const path = new URL(String(input)).pathname;
                    fetched.push(path);
                    return new Response(path === '/' ? 'app' : 'landing', {
                        headers: { 'Content-Type': 'text/html', 'Cross-Origin-Embedder-Policy': 'require-corp' },
                    });
                },
            },
        },
        waitUntil: () => {},
        next: vi.fn(async () => new Response('next')),
    };
    return { response: onRequest(context), fetched, context };
}

const PAGE_LOAD = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

describe('the / Pages Function', () => {
    it('serves the landing page to a page load without the cookie', async () => {
        const { response, fetched } = call(PAGE_LOAD);
        expect(await (await response).text()).toBe('landing');
        expect(fetched).toEqual(['/landing/']);
    });

    it('serves the app with the cookie', async () => {
        for (const cookie of ['journal_session=1', 'a=b; journal_session=1', 'a=b;journal_session=1; c=d']) {
            const { response } = call({ ...PAGE_LOAD, Cookie: cookie });
            expect(await (await response).text(), cookie).toBe('app');
        }
    });

    it('does not take a cookie that only ends in journal_session', async () => {
        const { response } = call({ ...PAGE_LOAD, Cookie: 'not_journal_session=1' });
        expect(await (await response).text()).toBe('landing');
    });

    it('always serves the app to a fetch that does not ask for HTML (the service worker precache)', async () => {
        for (const headers of [{}, { Accept: '*/*' }] as Record<string, string>[]) {
            const { response } = call(headers);
            expect(await (await response).text()).toBe('app');
        }
    });

    it('marks both answers private and varying by cookie, and keeps the asset headers', async () => {
        for (const headers of [PAGE_LOAD, { ...PAGE_LOAD, Cookie: 'journal_session=1' }]) {
            const res = await call(headers).response;
            expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
            expect(res.headers.get('Vary')).toBe('Cookie, Accept');
            expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
        }
    });

    it('passes other methods on', async () => {
        const { response, context, fetched } = call(PAGE_LOAD, 'POST');
        expect(await (await response).text()).toBe('next');
        expect(context.next).toHaveBeenCalled();
        expect(fetched).toEqual([]);
    });
});
