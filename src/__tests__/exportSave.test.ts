// @vitest-environment happy-dom
/** #1205: the export ZIP is a blob download on the web, the native app's Save dialog or share sheet. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import type { NativePlatform } from '@/lib/native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, downloadBlob, toast, exported } = vi.hoisted(() => ({
    invoke: vi.fn(),
    downloadBlob: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    exported: {
        success: true,
        count: 2,
        size: 3,
        filename: 'journal-export-2026-11-23T10-00-00.zip',
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        missingImages: 0,
        skippedLocked: 0,
    },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({}) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: vi.fn() }) }));
vi.mock('@/lib/importexport/ExportService', () => ({
    ExportService: { exportAllAsZip: async () => exported },
    downloadBlob,
}));

import { useImportExport } from '@/hooks/useImportExport';

let root: Root;
const result = { current: null as unknown as ReturnType<typeof useImportExport> };

const capture = (value: ReturnType<typeof useImportExport>) => { result.current = value; };

function Probe() {
    capture(useImportExport());
    return null;
}

async function exportOn(platform?: NativePlatform) {
    if (platform) window.__JOURNAL_NATIVE__ = { platform, plugins: [] };
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { await result.current.handleExport(); });
}

beforeEach(() => {
    vi.clearAllMocks();
    root = createRoot(document.createElement('div'));
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    delete window.__JOURNAL_NATIVE__;
});

describe('useImportExport export', () => {
    it('downloads the ZIP on the web without calling the native side', async () => {
        await exportOn();
        expect(downloadBlob).toHaveBeenCalledWith(exported.blob, exported.filename);
        expect(invoke).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Exported 2 items'));
    });

    it.each<NativePlatform>(['macos', 'windows', 'linux', 'ios', 'android'])(
        'hands the ZIP to the native save on %s instead of a download',
        async (platform) => {
            invoke.mockResolvedValue(true);
            await exportOn(platform);
            expect(invoke).toHaveBeenCalledWith('plugin:export|save', { name: exported.filename, data: 'AQID' });
            expect(downloadBlob).not.toHaveBeenCalled();
            expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Exported 2 items'));
            expect(result.current.isExporting).toBe(false);
        },
    );

    it('says nothing when the user cancels the Save dialog or share sheet', async () => {
        invoke.mockResolvedValue(false);
        await exportOn('ios');
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
        expect(result.current.isExporting).toBe(false);
    });

    it('reports a failed native save', async () => {
        invoke.mockRejectedValue('not a file name');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await exportOn('macos');
        expect(toast.success).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('Failed to export data');
    });
});
