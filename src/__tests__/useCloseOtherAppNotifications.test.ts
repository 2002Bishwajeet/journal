// @vitest-environment happy-dom
/** The quiet "other Homebase apps" notification closes when Journal opens or gains focus. */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useCloseOtherAppNotifications } from '@/hooks/useCloseOtherAppNotifications';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe() {
    useCloseOtherAppNotifications();
    return null;
}

describe('useCloseOtherAppNotifications', () => {
    it('closes homebase-other notifications on open and on focus, and stops after unmount', async () => {
        const close = vi.fn();
        const getNotifications = vi.fn(async () => [{ close }]);
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ getNotifications }) } });

        const root = createRoot(document.createElement('div'));
        await act(async () => root.render(h(Probe)));
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        expect(getNotifications).toHaveBeenCalledWith({ tag: 'homebase-other' });

        window.dispatchEvent(new Event('focus'));
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2));

        await act(async () => root.unmount());
        window.dispatchEvent(new Event('focus'));
        await new Promise((r) => setTimeout(r, 0));
        expect(close).toHaveBeenCalledTimes(2);
    });
});
