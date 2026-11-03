/**
 * #913: journal.cloudx.run is the landing page and the app lives under /app/, on the same
 * origin. These check the pieces that move people there: the landing page's head script,
 * the root service worker that replaces the one an app installed at / still has, and the
 * sign-in return URL.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@homebase-id/js-lib/auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/auth')>()),
    saveEccKey: vi.fn(),
}));

import { useYouAuthAuthorization } from '@/hooks/auth/useYouAuthAuthorization';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

// The first inline script in the landing page's head.
const LANDING_SCRIPT = read('site/index.html').match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/)![1];

/** Runs the landing page's head script at `url`; returns where it sent the visitor, if anywhere. */
function landAt(url: string, { secret, standalone = false }: { secret?: string; standalone?: boolean } = {}) {
    const { pathname, search, hash } = new URL(url, 'https://journal.test');
    const replace = vi.fn();
    new Function('location', 'localStorage', 'matchMedia', 'navigator', LANDING_SCRIPT)(
        { pathname, search, hash, replace },
        { getItem: (key: string) => (key === 'APSS' ? (secret ?? null) : null) },
        (query: string) => ({ matches: standalone && query === '(display-mode: standalone)' }),
        {},
    );
    return replace.mock.calls[0]?.[0] as string | undefined;
}

describe('landing page head script', () => {
    it('should keep a signed-out visitor on the landing page', () => {
        expect(landAt('/')).toBeUndefined();
    });

    it('should send a signed-in visitor to the app', () => {
        expect(landAt('/', { secret: 'c2VjcmV0' })).toBe('/app/');
    });

    it('should show the landing page with ?landing, even when signed in', () => {
        expect(landAt('/?landing', { secret: 'c2VjcmV0' })).toBeUndefined();
        expect(landAt('/?x=1&landing=1', { secret: 'c2VjcmV0' })).toBeUndefined();
    });

    it('should open the app for the installed app, keeping its shortcut query', () => {
        expect(landAt('/?action=new', { standalone: true })).toBe('/app/?action=new');
    });

    it('should send an old app link (a path with no file) to the same path under /app/', () => {
        expect(landAt('/3f1c2b7a/n1?tag=x#h')).toBe('/app/3f1c2b7a/n1?tag=x#h');
    });
});

describe('root service worker (sw.js at /)', () => {
    it('should drop the old app precache, unregister itself and reload its pages', async () => {
        const handlers: Record<string, (event: { waitUntil: (p: Promise<unknown>) => void }) => void> = {};
        const done: Promise<unknown>[] = [];
        const navigate = vi.fn();
        const self = {
            addEventListener: (type: string, handler: (typeof handlers)[string]) => (handlers[type] = handler),
            skipWaiting: vi.fn(),
            registration: { scope: 'https://journal.test/', unregister: vi.fn(async () => true) },
            clients: { matchAll: vi.fn(async () => [{ url: 'https://journal.test/f1/n1', navigate }]) },
        };
        const caches = { delete: vi.fn(async () => true) };
        new Function('self', 'caches', read('site/public/sw.js'))(self, caches);

        handlers.install({ waitUntil: (p) => done.push(p) });
        expect(self.skipWaiting).toHaveBeenCalled();
        handlers.activate({ waitUntil: (p) => done.push(p) });
        await Promise.all(done);

        expect(caches.delete).toHaveBeenCalledWith('workbox-precache-v2-https://journal.test/');
        expect(self.registration.unregister).toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith('https://journal.test/f1/n1');
    });
});

describe('sign-in under /app/', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { location: { origin: 'https://journal.test' } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should return from Homebase to the app\'s /app/auth/finalize', async () => {
        const params = await useYouAuthAuthorization().getAuthorizationParameters('https://journal.test/app/f1');
        expect(params.redirect_uri).toBe('https://journal.test/app/auth/finalize');
        expect(params.state).toBe('https://journal.test/app/f1');
    });
});
