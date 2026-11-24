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

async function render(needed?: boolean) {
    m.useSecurityContext.mockImplementation((_id: unknown, enabled?: boolean) => ({
        fetch: { data: enabled === false ? undefined : { permissionContext: { permissionGroups: [] } }, isError: false },
    }));
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    function Probe() {
        usePeerAccess(needed);
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
});
