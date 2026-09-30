import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Database,
  Shield,
  Download,
  FolderInput,
  Loader2,
  Lock,
} from "lucide-react";
import { useImportExport } from "@/hooks/useImportExport";
import { SectionHeader } from "../SectionHeader";

export default function DataSection() {
  const { isExporting, isImporting, handleExport, handleImport } =
    useImportExport();
  const importInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-10">
      {/* Storage */}
      <div className="space-y-6">
        <SectionHeader subtitle="Where your journal lives">
          Storage
        </SectionHeader>
        <div className="rounded-xl border border-border/60 p-5 bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="font-semibold text-sm">
                Homebase Drive
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dedicated encrypted drive ·{" "}
                <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">
                  f4b63...
                </code>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Import / Export */}
      <div className="space-y-6">
        <SectionHeader subtitle="Move data in and out of your journal">
          Data Portability
        </SectionHeader>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            ref={importInputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            accept=".md,.zip,.csv"
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
          <div className="flex-1 space-y-1 text-center">
            <Button
              variant="outline"
              className="w-full h-11 md:h-9"
              onClick={() => importInputRef.current?.click()}
              disabled={isImporting}
              aria-describedby="import-hint"
            >
              {isImporting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FolderInput />
              )}
              {isImporting ? "Importing..." : "Import Archive"}
            </Button>
            <p id="import-hint" className="text-xs text-muted-foreground">
              .md, .zip, or .csv
            </p>
          </div>
          <div className="flex-1 space-y-1 text-center">
            <Button
              variant="outline"
              className="w-full h-11 md:h-9"
              onClick={handleExport}
              disabled={isExporting}
              aria-describedby="export-hint"
            >
              {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
              {isExporting ? "Exporting..." : "Export All Notes"}
            </Button>
            <p id="export-hint" className="text-xs text-muted-foreground">
              Download your data
            </p>
          </div>
        </div>
      </div>

      {/* Security */}
      <div className="space-y-6">
        <SectionHeader subtitle="How your data is protected">
          Security
        </SectionHeader>
        <div className="rounded-xl border bg-muted/40 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <Lock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <span className="font-semibold text-sm">
                End-to-End Encrypted
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Only you hold the keys
              </p>
            </div>
          </div>
          <div className="pl-[52px]">
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-center gap-2">
                <Shield className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                All sync traffic is fully encrypted
              </li>
              <li className="flex items-center gap-2">
                <Shield className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                Cryptographic keys never leave your device
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
