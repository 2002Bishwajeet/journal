import { ChevronRight, CloudOff, Loader2, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSyncIndicator } from "@/hooks/useSyncIndicator";

const ICONS = { syncing: Loader2, offline: WifiOff, error: CloudOff, failed: CloudOff };

/**
 * Phone only (#1162): a small pill in the bar above a large title (home, a note list, Shared)
 * while a sync runs, while offline, or when sync failed. Gone when there is nothing to say.
 * It sits in the bar's empty middle, so it never moves the title; with the bar title shown
 * (scrolled), it takes the bar title's place until it goes (index.css). Render it right
 * before BarTitle.
 */
export function MobileSyncPill() {
  const { indicator, act } = useSyncIndicator();
  if (!indicator) return null;

  const Icon = ICONS[indicator.kind];
  const alert = indicator.kind === "error" || indicator.kind === "failed";
  const content = (
    <>
      <Icon
        className={cn("size-3.5 shrink-0", indicator.kind === "syncing" && "animate-spin")}
        aria-hidden
      />
      <span className="truncate tabular-nums">{indicator.label}</span>
      {indicator.kind === "error" && <span className="font-semibold text-foreground">Retry</span>}
      {indicator.kind === "failed" && <ChevronRight className="-mr-1 size-3.5 shrink-0" aria-hidden />}
    </>
  );
  const pillClass = cn(
    "sync-pill pointer-events-auto flex h-7 max-w-full items-center gap-1.5 rounded-full bg-muted/70 px-3 text-[13px] font-medium select-none",
    alert ? "text-destructive dark:text-red-400" : "text-muted-foreground",
  );

  return (
    <div className="sync-pill-row pointer-events-none absolute inset-x-24 flex justify-center">
      {"action" in indicator ? (
        <button
          type="button"
          onClick={act}
          aria-label={indicator.kind === "error" ? "Couldn't sync. Retry" : `${indicator.label}. Show details`}
          className={cn(pillClass, "outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-[3px] focus-visible:ring-ring/50")}
        >
          {content}
        </button>
      ) : (
        <div role="status" className={pillClass}>
          {content}
        </div>
      )}
    </div>
  );
}
