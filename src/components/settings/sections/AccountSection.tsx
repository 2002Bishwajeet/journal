import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import SignOutConfirmDialog from "@/components/modals/SignOutConfirmDialog";
import { useAccountSettings } from "@/hooks/useAccountSettings";
import { cn, formatRelativeTime } from "@/lib/utils/index";
import { SettingsRow } from "../SettingsRow";

export default function AccountSection() {
  const { identity, syncStatus, lastSyncedAt, pendingTotal, syncNow, signOut } =
    useAccountSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isSyncing = syncStatus === "syncing";

  let statusText =
    syncStatus === "syncing"
      ? "Syncing…"
      : syncStatus === "error"
        ? "Last sync failed"
        : syncStatus === "offline"
          ? "Offline — changes will sync when you're back online"
          : lastSyncedAt
            ? `Up to date · last synced ${formatRelativeTime(lastSyncedAt)}`
            : "Up to date";
  if (pendingTotal > 0) {
    statusText += ` · ${pendingTotal} ${pendingTotal === 1 ? "change" : "changes"} waiting`;
  }

  return (
    <div className="rounded-lg border">
      <SettingsRow
        id="account-identity"
        label="Signed in as"
        control={<span className="font-mono text-sm break-all">{identity}</span>}
      />
      <SettingsRow
        id="account-sync"
        label="Sync"
        description={
          <span
            role="status"
            aria-live="polite"
            className={cn(syncStatus === "error" && "text-destructive dark:text-red-400")}
          >
            {statusText}
          </span>
        }
        control={
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-0"
            // The row label ("Sync") would otherwise name it; keep the visible text.
            aria-label="Sync now"
            disabled={isSyncing}
            onClick={() => syncNow()}
          >
            {isSyncing && <Loader2 className="h-4 w-4 animate-spin" />}
            Sync now
          </Button>
        }
      />
      <SettingsRow
        id="account-sign-out"
        label="Sign out"
        control={
          <Button
            variant="outline"
            // The dark --destructive token (#7f1d1d) is ~1.7:1 on the dialog; red-400 reads.
            className="min-h-11 md:min-h-0 text-destructive hover:text-destructive dark:text-red-400 dark:hover:text-red-400"
            onClick={() => setConfirmOpen(true)}
          >
            Sign out
          </Button>
        }
      />
      <SignOutConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => signOut()}
        pendingTotal={pendingTotal}
      />
    </div>
  );
}
