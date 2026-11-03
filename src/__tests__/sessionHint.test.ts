// @vitest-environment happy-dom
/**
 * The edge's routing hint (#913): functions/index.ts serves the app at / with the
 * journal_session cookie and the landing page without it. The app sets it on sign-in
 * and on every signed-in boot, and clears it on logout (the auto-logout path too).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
    hasValidToken: undefined as boolean | undefined,
    finalizeAuthentication: vi.fn(),
}));

vi.mock('@/hooks/auth/useVerifyToken', () => ({
    useVerifyToken: () => ({ data: mocks.hasValidToken, isFetchedAfterMount: mocks.hasValidToken !== undefined }),
}));
vi.mock('@/hooks/useOnlineContext', () => ({ useOnlineContext: () => ({ isOnline: true }) }));
vi.mock('@/lib/homebase/WebPushProvider', () => ({ removeWebPush: vi.fn(async () => {}) }));
vi.mock('@/lib/db', () => ({ clearAllLocalData: vi.fn(async () => {}) }));
vi.mock('@homebase-id/js-lib/auth', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    logout: vi.fn(async () => {}),
    retrieveIdentity: () => localStorage.getItem('identity'),
    finalizeAuthentication: mocks.finalizeAuthentication,
    retrieveEccKey: vi.fn(async () => ({})),
    throwAwayTheECCKey: vi.fn(),
    saveIdentity: (identity: string) => localStorage.setItem('identity', identity),
}));

import { clearSessionHint, setSessionHint } from '@/lib/sessionHint';
import { useAuth } from '@/hooks/auth/useAuth';
import { useYouAuthAuthorization } from '@/hooks/auth/useYouAuthAuthorization';

const SET = 'journal_session=1; Path=/; Secure; SameSite=Lax; Max-Age=34560000';
const CLEAR = 'journal_session=; Path=/; Secure; SameSite=Lax; Max-Age=0';

let writes: string[];
let replace: ReturnType<typeof vi.fn>;
let root: Root | undefined;

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    mocks.hasValidToken = undefined;
    writes = [];
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => '',
        set: (value: string) => void writes.push(value),
    });
    replace = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, replace } as Location);
});

afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.restoreAllMocks();
});

function signIn() {
    localStorage.setItem('identity', 'frodo.dotyou.cloud');
    localStorage.setItem('APSS', 'AAAA');
}

async function renderAuth(): Promise<ReturnType<typeof useAuth>> {
    let auth!: ReturnType<typeof useAuth>;
    function Probe() {
        auth = useAuth();
        return null;
    }
    root = createRoot(document.createElement('div'));
    await act(async () => root!.render(h(Probe)));
    return auth;
}

describe('session hint cookie', () => {
    it('sets a 400-day, non-secret routing cookie for the whole origin', () => {
        setSessionHint();
        expect(writes).toEqual([SET]);
    });

    it('clears it with Max-Age=0 and the same path', () => {
        clearSessionHint();
        expect(writes).toEqual([CLEAR]);
    });

    it('is set on a signed-in boot', async () => {
        signIn();
        await renderAuth();
        expect(writes).toContain(SET);
    });

    it('is not set on a signed-out boot', async () => {
        await renderAuth();
        expect(writes).toEqual([]);
    });

    it('is set when sign-in finalizes', async () => {
        mocks.finalizeAuthentication.mockResolvedValue({ clientAuthToken: 'token', sharedSecret: 'secret' });
        let finalize!: ReturnType<typeof useYouAuthAuthorization>['finalizeAuthorization'];
        function Probe() {
            finalize = useYouAuthAuthorization().finalizeAuthorization;
            return null;
        }
        root = createRoot(document.createElement('div'));
        await act(async () => root!.render(h(Probe)));

        expect(await finalize('frodo.dotyou.cloud', 'key', 'salt')).toBe(true);
        expect(writes).toEqual([SET]);
    });

    it('is not set when sign-in fails', async () => {
        mocks.finalizeAuthentication.mockRejectedValue(new Error('nope'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        let finalize!: ReturnType<typeof useYouAuthAuthorization>['finalizeAuthorization'];
        function Probe() {
            finalize = useYouAuthAuthorization().finalizeAuthorization;
            return null;
        }
        root = createRoot(document.createElement('div'));
        await act(async () => root!.render(h(Probe)));

        expect(await finalize('frodo.dotyou.cloud', 'key', 'salt')).toBe(false);
        expect(writes).toEqual([]);
    });

    it('is cleared on logout, which then goes to / (the landing page)', async () => {
        signIn();
        const auth = await renderAuth();
        writes = [];

        await act(() => auth.logout());

        expect(writes).toEqual([CLEAR]);
        expect(replace).toHaveBeenCalledWith('/');
        expect(localStorage.getItem('APSS')).toBeNull();
    });

    it('is cleared on the auto-logout when the token is no longer valid', async () => {
        signIn();
        mocks.hasValidToken = false;
        await renderAuth();
        await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
        expect(writes.at(-1)).toBe(CLEAR);
    });
});
