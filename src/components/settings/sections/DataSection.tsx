import { cn } from "@/lib/utils";
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
                <code className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
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
          {/* Import */}
          <div className="relative flex-1">
            <input
              type="file"
              id="import-file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
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
            <div
              className={cn(
                "rounded-xl border border-dashed border-border p-5 text-center transition-colors hover:border-[#B8860B]/40 hover:bg-[#B8860B]/[0.02]",
                isImporting && "opacity-60 pointer-events-none"
              )}
            >
              {isImporting ? (
                <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
              ) : (
                <FolderInput className="h-6 w-6 mx-auto text-muted-foreground" />
              )}
              <p className="text-sm font-medium mt-2">
                {isImporting ? "Importing..." : "Import Archive"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                .md, .zip, or .csv
              </p>
            </div>
          </div>

          {/* Export */}
          <button
            className={cn(
              "flex-1 rounded-xl border border-dashed border-border p-5 text-center transition-colors hover:border-[#B8860B]/40 hover:bg-[#B8860B]/[0.02]",
              isExporting && "opacity-60 pointer-events-none"
            )}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
            ) : (
              <Download className="h-6 w-6 mx-auto text-muted-foreground" />
            )}
            <p className="text-sm font-medium mt-2">
              {isExporting ? "Exporting..." : "Export All Notes"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Download your data
            </p>
          </button>
        </div>
      </div>

      {/* Security */}
      <div className="space-y-6">
        <SectionHeader subtitle="How your data is protected">
          Security
        </SectionHeader>
        <div
          className="rounded-xl p-5 space-y-4 relative overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(16, 185, 129, 0.01) 100%)",
            border: "1px solid rgba(16, 185, 129, 0.15)",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100/80 dark:bg-emerald-900/30 flex items-center justify-center">
              <Lock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">
                End-to-End Encrypted
              </span>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-0.5">
                Only you hold the keys
              </p>
            </div>
          </div>
          <div className="pl-[52px]">
            <ul className="text-sm text-emerald-800/70 dark:text-emerald-400/70 space-y-1.5">
              <li className="flex items-center gap-2">
                <Shield className="h-3 w-3 shrink-0" />
                All sync traffic is fully encrypted
              </li>
              <li className="flex items-center gap-2">
                <Shield className="h-3 w-3 shrink-0" />
                Cryptographic keys never leave your device
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
