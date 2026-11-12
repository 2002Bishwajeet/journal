// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/hooks/useImportExport', () => ({
    useImportExport: () => ({ isExporting: false, isImporting: false, handleExport: vi.fn(), handleImport: vi.fn() }),
}));
vi.mock('@/hooks/auth', () => ({
    useAuth: () => ({ getIdentity: () => 'frodo.example.com' }),
}));

import DataSection from '@/components/settings/sections/DataSection';

async function renderText() {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(createElement(DataSection)); });
    const text = host.textContent ?? '';
    await act(async () => { root.unmount(); });
    return text;
}

describe('DataSection storage status', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.__JOURNAL_NATIVE__;
    });

    it('offers Protect in a browser that has not persisted storage', async () => {
        vi.stubGlobal('navigator', {
            storage: { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn() },
        });
        const text = await renderText();
        expect(text).toContain('Protected from browser cleanup');
        expect(text).toMatch(/Protect(?!ed)/);
        expect(text).not.toContain('Stored in the app on this device');
    });

    it('shows app storage instead of the browser control in the native app', async () => {
        vi.stubGlobal('navigator', {
            storage: { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn() },
        });
        window.__JOURNAL_NATIVE__ = { platform: 'ios' };
        const text = await renderText();
        expect(text).toContain('Stored in the app on this device');
        expect(text).not.toContain('Protected from browser cleanup');
        expect(text).not.toMatch(/Protect(?!ed)/);
    });
});
