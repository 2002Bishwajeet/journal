// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { handleImport } = vi.hoisted(() => ({ handleImport: vi.fn() }));
vi.mock('@/hooks/useImportExport', () => ({
    useImportExport: () => ({
        isExporting: false,
        isImporting: false,
        handleExport: vi.fn(),
        handleImport,
    }),
}));

import DataSection from '@/components/settings/sections/DataSection';

describe('DataSection import', () => {
    it('passes a snapshot of the files that survives the input reset', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => { root.render(createElement(DataSection)); });

        const input = host.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['# hi'], 'note.md', { type: 'text/markdown' });
        // Emulate the browser: value = "" empties the live FileList
        const files: File[] = [file];
        Object.defineProperty(input, 'files', { get: () => files, configurable: true });
        Object.defineProperty(input, 'value', {
            get: () => '',
            set: () => { files.length = 0; },
            configurable: true,
        });

        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(handleImport).toHaveBeenCalledTimes(1);
        const received = handleImport.mock.calls[0][0] as File[];
        expect(received.map((f) => f.name)).toEqual(['note.md']);

        await act(async () => { root.unmount(); });
    });
});
