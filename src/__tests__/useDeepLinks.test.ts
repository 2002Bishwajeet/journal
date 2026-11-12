// @vitest-environment happy-dom
/**
 * journal:// hand-off (#1144): a second launch's URL is forwarded by the single-instance
 * plugin to the running window, which the deep-link plugin delivers to `onOpenUrl`.
 * The hook must route it once, and do nothing on the web.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    isNativeApp: vi.fn(() => true),
    getCurrent: vi.fn<() => Promise<string[] | null>>(async () => null),
    onOpenUrl: vi.fn(),
    forward: undefined as ((urls: string[]) => void) | undefined,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/lib/native', () => ({ isNativeApp: mocks.isNativeApp }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ getCurrent: mocks.getCurrent, onOpenUrl: mocks.onOpenUrl }));

import { useDeepLinks } from '@/hooks/useDeepLinks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
    const root = createRoot(document.createElement('div'));
    await act(async () => {
        root.render(h(function C() { useDeepLinks(); return null; }));
    });
    return root;
}

describe('useDeepLinks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        mocks.isNativeApp.mockReturnValue(true);
        mocks.getCurrent.mockResolvedValue(null);
        mocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
            mocks.forward = cb;
            return () => {};
        });
    });

    it('routes a URL forwarded by a second launch once', async () => {
        await mount();
        await act(async () => mocks.forward!(['journal://share/alice.dotyou.cloud/n1']));
        expect(mocks.navigate).toHaveBeenCalledTimes(1);
        expect(mocks.navigate).toHaveBeenCalledWith('/share/alice.dotyou.cloud/n1');
    });

    it('routes the cold-start URL', async () => {
        mocks.getCurrent.mockResolvedValue(['journal://share/alice.dotyou.cloud/n2']);
        await mount();
        expect(mocks.navigate).toHaveBeenCalledWith('/share/alice.dotyou.cloud/n2');
    });

    it('is a no-op on the web', async () => {
        mocks.isNativeApp.mockReturnValue(false);
        await mount();
        expect(mocks.onOpenUrl).not.toHaveBeenCalled();
        expect(mocks.navigate).not.toHaveBeenCalled();
    });
});
