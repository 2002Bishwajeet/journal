// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { toast } = vi.hoisted(() => ({
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({}) }));
const { sync } = vi.hoisted(() => ({ sync: vi.fn(async () => {}) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync }) }));
vi.mock('@/lib/db/queries', () => ({
    getAllFolders: vi.fn().mockResolvedValue([]),
    upsertSyncRecord: vi.fn(),
    saveDocumentUpdate: vi.fn(),
    upsertSearchIndex: vi.fn(),
    createFolder: vi.fn(),
}));

import { ImportService } from '@/lib/importexport/ImportService';
import { useImportExport, type UseImportExportReturn } from '@/hooks/useImportExport';

describe('importing an unsupported file', () => {
    it('counts it as failed and records its file name', async () => {
        const result = await ImportService.importFiles([new File(['hi'], 'notes.txt')]);
        expect(result.imported).toBe(0);
        expect(result.failed).toBe(1);
        expect(result.errors[0].file).toBe('notes.txt');
    });

    it('shows a warning toast naming the file', async () => {
        const latest: { current: UseImportExportReturn | null } = { current: null };
        function Probe() {
            latest.current = useImportExport();
            return null;
        }
        const root = createRoot(document.createElement('div'));
        await act(async () => { root.render(createElement(Probe)); });

        await act(async () => {
            await latest.current!.handleImport([new File(['a'], 'notes.txt'), new File(['b'], 'data.csv')]);
        });

        expect(toast.warning).toHaveBeenCalledWith(
            "Imported 0 notes. 2 files couldn't be imported (e.g. notes.txt)."
        );
        // Nothing imported, so nothing to sync.
        expect(sync).not.toHaveBeenCalled();
        await act(async () => { root.unmount(); });
    });
});
