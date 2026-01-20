import { useState, useCallback } from "react";
import { toast } from "sonner";

export interface UseSettingsModalReturn {
    // State
    isExporting: boolean;
    isImporting: boolean;

    // Handlers
    handleExport: () => Promise<void>;
    handleImport: (files: FileList) => Promise<void>;
}

export function useSettingsModal(): UseSettingsModalReturn {
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const handleExport = useCallback(async () => {
        try {
            setIsExporting(true);
            const { ExportService } = await import("@/lib/importexport/ExportService");
            const result = await ExportService.exportAllAsZip();
            toast.success(`Exported ${result.count} items (${(result.size / 1024).toFixed(1)} KB)`);
        } catch (error) {
            console.error("Export error:", error);
            toast.error("Failed to export data");
        } finally {
            setIsExporting(false);
        }
    }, []);

    const handleImport = useCallback(async (files: FileList) => {
        try {
            setIsImporting(true);
            const { ImportService } = await import("@/lib/importexport/ImportService");
            const result = await ImportService.importFiles(files);

            if (result.failed > 0) {
                toast.warning(
                    `Import complete: ${result.imported} imported, ${result.foldersCreated} folders created. ${result.failed} failed.`
                );
            } else {
                toast.success(
                    `Successfully imported ${result.imported} notes and created ${result.foldersCreated} folders.`
                );
            }

            if (result.errors.length > 0) {
                console.warn("Import errors:", result.errors);
            }
        } catch (error) {
            console.error("Import error:", error);
            toast.error("Critical error during import");
        } finally {
            setIsImporting(false);
        }
    }, []);

    return {
        isExporting,
        isImporting,
        handleExport,
        handleImport,
    };
}
