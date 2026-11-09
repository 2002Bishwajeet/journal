// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

// A model outside the catalogue runs once it is downloaded, so the AI eval can try any web-llm id (#1022).

const cached = vi.hoisted(() => new Set<string>());
vi.mock('@/hooks/useDeviceType', () => ({ useDeviceType: () => 'desktop' }));
vi.mock('@/lib/webllm', () => ({
    getModelInfo: () => undefined,
    isModelCached: async (id: string) => cached.has(id),
}));

import { useModelDownloadGate } from '@/hooks/useModelDownloadGate';

async function gate() {
    let api!: ReturnType<typeof useModelDownloadGate>;
    const Probe = () => {
        api = useModelDownloadGate();
        return null;
    };
    await act(async () => createRoot(document.createElement('div')).render(h(Probe)));
    return api;
}

describe('useModelDownloadGate, for a model outside the catalogue', () => {
    it('lets it run once it is downloaded', async () => {
        cached.add('gemma-4-E2B-it-q4f16_1-MLC');
        expect(await (await gate()).confirmDownload('gemma-4-E2B-it-q4f16_1-MLC')).toBe(true);
    });

    it('refuses it before, without asking', async () => {
        const api = await gate();
        expect(await api.confirmDownload('Phi-4-mini-instruct-q4f16_1-MLC')).toBe(false);
        expect(api.dialogProps.pending).toBeNull();
    });
});
