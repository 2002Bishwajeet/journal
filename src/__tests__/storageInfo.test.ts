// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';
import { formatBytes, useStorageInfo, type StorageInfo } from '@/hooks/useStorageInfo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mountHook() {
    const latest: { current: StorageInfo | null } = { current: null };
    function Probe() {
        latest.current = useStorageInfo();
        return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(createElement(Probe)); });
    return { latest, unmount: () => act(async () => { root.unmount(); }) };
}

describe('formatBytes', () => {
    it('formats sizes with a readable unit', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1023)).toBe('1023 B');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
        expect(formatBytes(850 * 1024 ** 2)).toBe('850 MB');
    });
});

describe('useStorageInfo', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('reads usage, quota and persisted, and requestPersist updates persisted', async () => {
        const persist = vi.fn().mockResolvedValue(true);
        vi.stubGlobal('navigator', {
            storage: {
                estimate: vi.fn().mockResolvedValue({ usage: 1536, quota: 5 * 1024 ** 3 }),
                persisted: vi.fn().mockResolvedValue(false),
                persist,
            },
        });

        const { latest, unmount } = await mountHook();
        expect(latest.current).toMatchObject({ usage: 1536, quota: 5 * 1024 ** 3, persisted: false });

        let granted: boolean | undefined;
        await act(async () => { granted = await latest.current!.requestPersist(); });
        expect(persist).toHaveBeenCalledTimes(1);
        expect(granted).toBe(true);
        expect(latest.current!.persisted).toBe(true);

        await unmount();
    });

    it('keeps persisted false when the browser refuses', async () => {
        vi.stubGlobal('navigator', {
            storage: {
                estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 }),
                persisted: vi.fn().mockResolvedValue(false),
                persist: vi.fn().mockResolvedValue(false),
            },
        });

        const { latest, unmount } = await mountHook();
        let granted: boolean | undefined;
        await act(async () => { granted = await latest.current!.requestPersist(); });
        expect(granted).toBe(false);
        expect(latest.current!.persisted).toBe(false);

        await unmount();
    });

    it('returns nulls when the Storage API is missing', async () => {
        vi.stubGlobal('navigator', {});

        const { latest, unmount } = await mountHook();
        expect(latest.current).toMatchObject({ usage: null, quota: null, persisted: null });
        let granted: boolean | undefined;
        await act(async () => { granted = await latest.current!.requestPersist(); });
        expect(granted).toBe(false);
        expect(latest.current!.persisted).toBeNull();

        await unmount();
    });
});
