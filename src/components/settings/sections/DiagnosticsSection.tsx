import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Loader2, RefreshCw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDiagnostics } from "@/hooks/useDiagnostics";
import { MAIN_FOLDER_ID } from "@/lib/homebase";
import { explainSyncError } from "@/lib/diagnostics/report";
import type { PendingItemStatus, PendingSyncItem } from "@/lib/db/queries/diagnostics";
import { cn, formatRelativeTime } from "@/lib/utils/index";
import { SectionHeader } from "../SectionHeader";
import { SettingsRow } from "../SettingsRow";

const STATUS_LABEL: Record<PendingItemStatus, string> = {
  pending: "Pending",
  retrying: "Retrying",
  failed: "Failed",
};

const STATUS_STYLE: Record<PendingItemStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  retrying: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300",
  failed: "bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-300",
};

const KIND_LABEL = { note: "Note", folder: "Folder", image: "Image" } as const;

function retryIn(nextRetryAt: string): string {
  const seconds = Math.round((new Date(nextRetryAt).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "due now";
  if (seconds < 60) return `in ${seconds}s`;
  if (seconds < 3600) return `in ${Math.round(seconds / 60)}m`;
  return `in ${Math.round(seconds / 3600)}h`;
}

function itemTitle(item: PendingSyncItem): string {
  if (item.kind === "image") return item.title ? `Image in "${item.title}"` : "Image";
  if (item.title) return item.title;
  return item.isDelete ? "Deleted item" : "Untitled";
}

function PendingRow({
  item,
  busy,
  canRetry,
  onRetry,
  onOpen,
}: {
  item: PendingSyncItem;
  busy: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onOpen: () => void;
}) {
  const explained = item.error ? explainSyncError(item.error) : null;
  const details = [
    KIND_LABEL[item.kind],
    item.isDelete ? "waiting to delete" : null,
    item.contentType,
    item.retryCount > 0 ? `${item.retryCount} ${item.retryCount === 1 ? "retry" : "retries"}` : null,
    item.nextRetryAt ? `next retry ${retryIn(item.nextRetryAt)}` : null,
    item.lastSyncedAt ? `last synced ${formatRelativeTime(item.lastSyncedAt)}` : "never synced",
  ].filter(Boolean);
  const heading = (
    <>
      <span className="line-clamp-2 text-sm leading-5 font-medium wrap-anywhere underline-offset-4 group-hover:underline">
        {itemTitle(item)}
      </span>
      <span className="block text-xs leading-relaxed text-muted-foreground">{details.join(" · ")}</span>
    </>
  );

  return (
    <li data-testid="pending-item" className="space-y-2 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        {item.noteId ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={itemTitle(item)}
            className="group min-h-11 min-w-0 flex-1 space-y-0.5 text-left md:min-h-0"
          >
            {heading}
          </button>
        ) : (
          <div className="min-w-0 flex-1 space-y-0.5">{heading}</div>
        )}
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[item.status])}>
          {STATUS_LABEL[item.status]}
        </span>
      </div>

      {item.error && explained && (
        <div className="space-y-1 rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-xs leading-relaxed text-pretty">{explained.plain}</p>
          <p className="font-mono text-xs leading-relaxed text-muted-foreground wrap-anywhere">
            {explained.code ? `${explained.code} · ` : ""}
            {item.error.message}
          </p>
        </div>
      )}
      {!item.error && item.status === "failed" && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Gave up after {item.retryCount} {item.retryCount === 1 ? "try" : "tries"}. Retry to start again.
        </p>
      )}

      <Button
        variant="outline"
        size="sm"
        className="min-h-11 md:min-h-0"
        disabled={busy || !canRetry}
        aria-label={`Retry ${itemTitle(item)}`}
        onClick={onRetry}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Retry now
      </Button>
    </li>
  );
}

export default function DiagnosticsSection({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const diagnostics = useDiagnostics();
  const [errorsOnly, setErrorsOnly] = useState(false);
  const { items, isSyncing, isOnline } = diagnostics;
  const canRetry = isOnline && !isSyncing;

  const log = [...diagnostics.log].reverse().filter((entry) => !errorsOnly || entry.level !== "info");

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <SectionHeader subtitle="Changes on this device that haven't reached your Homebase yet, and why.">
          Pending sync items
        </SectionHeader>
        {items === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            Nothing is waiting to sync.
          </p>
        ) : (
          <ul aria-label="Pending sync items" className="overflow-hidden rounded-xl border bg-card">
            {items.map((item) => (
              <PendingRow
                key={`${item.kind}-${item.id}`}
                item={item}
                busy={diagnostics.retrying === item.id}
                canRetry={canRetry}
                onRetry={() => diagnostics.retryItem(item)}
                onOpen={() => {
                  navigate(`/${item.folderId ?? MAIN_FOLDER_ID}/${item.noteId}`);
                  close();
                }}
              />
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          className="min-h-11 w-full sm:w-auto md:min-h-9"
          disabled={!canRetry}
          onClick={() => diagnostics.retryAll()}
        >
          {isSyncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Retry now
        </Button>
      </div>

      <div className="space-y-4">
        <SectionHeader>Status</SectionHeader>
        <dl className="overflow-hidden rounded-xl border bg-card">
          {diagnostics.status.map((row) => (
            <div
              key={row.label}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b px-4 py-3 last:border-b-0"
            >
              <dt className="text-sm leading-5 font-medium">{row.label}</dt>
              <dd className="text-xs leading-relaxed text-muted-foreground wrap-anywhere">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-4">
        <SectionHeader subtitle="The last 200 warnings, errors and sync events, kept on this device.">
          Recent log
        </SectionHeader>
        <div className="overflow-hidden rounded-xl border bg-card">
          <SettingsRow
            id="diagnostics-errors-only"
            label="Errors and warnings only"
            control={<Switch checked={errorsOnly} onCheckedChange={setErrorsOnly} />}
          />
          {log.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">Nothing logged yet.</p>
          ) : (
            <ul aria-label="Recent log" className="max-h-80 overflow-y-auto">
              {log.map((entry, index) => (
                <li
                  key={`${entry.at}-${index}`}
                  className={cn(
                    "border-b px-4 py-2 font-mono text-xs leading-relaxed wrap-anywhere last:border-b-0",
                    entry.level === "error" && "text-destructive dark:text-red-400",
                    entry.level === "info" && "text-muted-foreground",
                  )}
                >
                  <span className="tabular-nums">{new Date(entry.at).toLocaleTimeString()}</span>{" "}
                  <span className="uppercase">{entry.level}</span> {entry.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <SectionHeader subtitle="A text report to paste into a GitHub issue or a chat. It never contains tokens, keys, cookies or note content.">
          Share a report
        </SectionHeader>
        <div className="overflow-hidden rounded-xl border bg-card">
          <SettingsRow
            id="diagnostics-include-titles"
            label="Include note titles"
            description="Off by default. Titles are yours, so they only go in the report if you turn this on."
            control={<Switch checked={diagnostics.includeTitles} onCheckedChange={diagnostics.setIncludeTitles} />}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11 w-full sm:w-auto md:min-h-9" onClick={diagnostics.copyReport}>
            <Copy />
            Copy diagnostics
          </Button>
          {diagnostics.canShare && (
            <Button variant="outline" className="min-h-11 w-full sm:w-auto md:min-h-9" onClick={diagnostics.shareReport}>
              <Share2 />
              Share
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
