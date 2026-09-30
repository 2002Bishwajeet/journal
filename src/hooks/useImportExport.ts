import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useDotYouClientContext } from "@/components/auth";

export interface UseImportExportReturn {
    // State
    isExporting: boolean;
    isImporting: boolean;

    // Handlers
    handleExport: () => Promise<void>;
    handleImport: (files: File[]) => Promise<void>;
}

export function useImportExport(): UseImportExportReturn {
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const dotYouClient = useDotYouClientContext();

    const handleExport = useCallback(async () => {
        try {
            setIsExporting(true);
            const { ExportService } = await import("@/lib/importexport/ExportService");
            const result = await ExportService.exportAllAsZip(dotYouClient);
            const missingImagesNote = result.missingImages > 0
                ? ` ${result.missingImages} images couldn't be exported (offline?)`
                : "";
            toast.success(`Exported ${result.count} items (${(result.size / 1024).toFixed(1)} KB).${missingImagesNote}`);
        } catch (error) {
            console.error("Export error:", error);
            toast.error("Failed to export data");
        } finally {
            setIsExporting(false);
        }
    }, [dotYouClient]);

    const handleImport = useCallback(async (files: File[]) => {
        try {
            setIsImporting(true);
            const { ImportService } = await import("@/lib/importexport/ImportService");
            const result = await ImportService.importFiles(files);

            if (result.failed > 0) {
                const noun = result.failed === 1 ? "file" : "files";
                const example = result.errors[0] ? ` (e.g. ${result.errors[0].file})` : "";
                toast.warning(
                    `Imported ${result.imported} notes. ${result.failed} ${noun} couldn't be imported${example}.`
                );
            } else {
                toast.success(
                    `Successfully imported ${result.imported} notes and created ${result.foldersCreated} folders.`
                );
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
