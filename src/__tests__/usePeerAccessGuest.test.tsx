// @vitest-environment happy-dom
/**
 * #1494: the public share page (a signed-out guest) must make no security-context request.
 * usePeerAccess asks for the context only when a peer call is possible.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const m = vi.hoisted(() => ({ useSecurityContext: vi.fn() }));
vi.mock('@/hooks/securityContext/useSecurityContext', () => ({ useSecurityContext: m.useSecurityContext }));

import { usePeerAccess } from '@/hooks/usePeerAccess';

let root: Root;
let el: HTMLElement;

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
    m.useSecurityContext.mockReset();
});

type Fetch = { data?: unknown; isError?: boolean };
const withKeys = (keys: number[]) => ({ permissionContext: { permissionGroups: [{ permissionSet: { keys } }] } });
const seen: { current: boolean | undefined } = { current: undefined };

async function render(needed?: boolean, fetch: Fetch = { data: withKeys([]) }) {
    m.useSecurityContext.mockImplementation((_id: unknown, enabled?: boolean) => ({
        fetch: enabled === false ? { data: undefined, isError: false } : { isError: false, ...fetch },
    }));
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    function Probe() {
        seen.current = usePeerAccess(needed);
        return null;
    }
    await act(async () => root.render(h(Probe)));
}

describe('usePeerAccess', () => {
    it('does not enable the security context fetch when no peer call is needed', async () => {
        await render(false);
        expect(m.useSecurityContext).toHaveBeenCalledWith(undefined, false);
    });

    it('enables the security context fetch by default for signed-in peer reads', async () => {
        await render();
        expect(m.useSecurityContext).toHaveBeenCalledWith(undefined, true);
    });

    it('fails open: true when the permissions could not be read', async () => {
        await render(true, { isError: true });
        expect(seen.current).toBe(true);
    });

    it('is undefined while the permissions load', async () => {
        await render(true, {});
        expect(seen.current).toBeUndefined();
    });

    it('is false only when the permissions loaded without peer read or send', async () => {
        await render(true, { data: withKeys([10, 405]) });
        expect(seen.current).toBe(false);
    });

    it('is true with peer read (305) or peer send (210)', async () => {
        await render(true, { data: withKeys([305]) });
        expect(seen.current).toBe(true);
    });
});
