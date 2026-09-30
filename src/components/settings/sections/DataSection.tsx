import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Download, FolderInput, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/auth";
import { useImportExport } from "@/hooks/useImportExport";
import { formatBytes, useStorageInfo } from "@/hooks/useStorageInfo";
import { SectionHeader } from "../SectionHeader";

export default function DataSection() {
  const { isExporting, isImporting, handleExport, handleImport } =
    useImportExport();
  const { getIdentity } = useAuth();
  const { usage, quota, persisted, requestPersist } = useStorageInfo();
  const importInputRef = useRef<HTMLInputElement>(null);

  const protect = async () => {
    if (!(await requestPersist())) {
      toast.info(
        "Your browser didn't allow this. Data is still synced to your Homebase."
      );
    }
  };

  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <SectionHeader>Where your notes live</SectionHeader>
        <p className="text-sm text-muted-foreground">
          Notes are stored on this device and synced, end-to-end encrypted, to
          your Homebase (
          <span className="font-medium text-foreground break-all">
            {getIdentity()}
          </span>
          ).
        </p>
      </div>

      {(usage !== null || persisted !== null) && (
        <div className="space-y-3">
          <SectionHeader>This device</SectionHeader>
          <div className="rounded-lg border">
            {usage !== null && (
              <div className="flex min-h-14 items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <h4 className="text-sm font-semibold">Storage used</h4>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(usage)}
                    {quota !== null && ` of ${formatBytes(quota)} available`}
                  </p>
                </div>
              </div>
            )}
            {persisted !== null && (
              <div className="flex min-h-14 items-center gap-3 border-b px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <h4 className="text-sm font-semibold">
                    Protected from browser cleanup
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {persisted
                      ? "Yes"
                      : "No — the browser may clear local data when space is low"}
                  </p>
                </div>
                {!persisted && (
                  <Button size="sm" variant="outline" onClick={protect}>
                    Protect
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <SectionHeader subtitle="Add Markdown files (.md) or a ZIP of Markdown files. Imported notes are added alongside existing ones; folders in a ZIP are matched by name.">
          Import
        </SectionHeader>
        <input
          ref={importInputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept=".md,.zip"
          multiple
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              // Snapshot: resetting the input empties the live FileList
              handleImport(Array.from(e.target.files));
              e.target.value = "";
            }
          }}
          disabled={isImporting}
        />
        <Button
          variant="outline"
          className="w-full h-11 sm:w-auto md:h-9"
          onClick={() => importInputRef.current?.click()}
          disabled={isImporting}
        >
          {isImporting ? <Loader2 className="animate-spin" /> : <FolderInput />}
          {isImporting ? "Importing..." : "Import Archive"}
        </Button>
      </div>

      <div className="space-y-3">
        <SectionHeader subtitle="Download all notes as a ZIP of Markdown files, one folder per journal folder.">
          Export
        </SectionHeader>
        <Button
          variant="outline"
          className="w-full h-11 sm:w-auto md:h-9"
          onClick={handleExport}
          disabled={isExporting}
        >
          {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
          {isExporting ? "Exporting..." : "Export All Notes"}
        </Button>
      </div>
    </div>
  );
}
