import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDotYouClientContext } from "@/components/auth";
import {
  SyncService,
  type SyncStatus,
  type SyncResult,
} from "@/lib/homebase/SyncService";
import {
  migrateExistingDataToSync,
  needsSyncMigration,
  getPendingSyncCount,
} from "@/lib/db";
import { SyncContext, type SyncContextType } from "@/hooks/useSyncService";
import { notesQueryKey } from "@/hooks/useNotes";
import { foldersQueryKey } from "@/hooks/useFolders";
import type { SyncProgress } from "@/types";

export interface PendingCount {
  notes: number;
  folders: number;
  images: number;
  total: number;
}

const RETRY_BACKOFF_MS = 5000; // 5 seconds between retry attempts

export function SyncProvider({ children }: { children: ReactNode }) {
  const dotYouClient = useDotYouClientContext();
  const queryClient = useQueryClient();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState<PendingCount>({
    notes: 0,
    folders: 0,
    images: 0,
    total: 0,
  });
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);

  // Refs for tracking state
  const hasInitialSynced = useRef(false);
  const hasMigrated = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncAttempt = useRef<number>(0);
  const syncFnRef = useRef<(() => Promise<void>) | null>(null);

  // Create sync service instance (memoized)
  const syncService = useMemo(() => {
    if (!dotYouClient) return null;
    return new SyncService(dotYouClient);
  }, [dotYouClient]);

  // Update pending count
  const refreshPendingCount = useCallback(async () => {
    try {
      const counts = await getPendingSyncCount();
      setPendingCount({
        ...counts,
        total: counts.notes + counts.folders + counts.images,
      });
    } catch (error) {
      console.error("[SyncProvider] Error getting pending count:", error);
    }
  }, []);

  // Run migration for existing data
  const runMigration = useCallback(async () => {
    if (hasMigrated.current) return;
    hasMigrated.current = true;

    try {
      const needsMigration = await needsSyncMigration();
      if (needsMigration) {
        console.log(
          "[SyncProvider] Migrating existing notes/folders to sync..."
        );
        const result = await migrateExistingDataToSync();
        console.log(
          `[SyncProvider] Migration complete: ${result.notes} notes, ${result.folders} folders`
        );
        await refreshPendingCount();
      }
    } catch (error) {
      console.error("[SyncProvider] Migration error:", error);
      hasMigrated.current = false; // Allow retry
    }
  }, [refreshPendingCount]);

  // Schedule a retry using ref to avoid circular dependency
  const scheduleRetry = useCallback(() => {
    retryTimeoutRef.current = setTimeout(() => {
      if (navigator.onLine && syncFnRef.current) {
        syncFnRef.current();
      }
    }, RETRY_BACKOFF_MS);
  }, []);

  // Full sync function with offline check
  const sync = useCallback(async () => {
    if (!syncService) return;

    // Don't sync if offline
    if (!navigator.onLine) {
      console.debug("[SyncProvider] Offline, skipping sync");
      return;
    }

    // Prevent too frequent syncs (debounce)
    const now = Date.now();
    if (now - lastSyncAttempt.current < 1000) {
      return;
    }
    lastSyncAttempt.current = now;

    // Clear any pending retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    setSyncStatus("syncing");
    setSyncProgress(null); // Reset progress
    try {
      const result = await syncService.sync(setSyncProgress);
      setLastSyncResult(result);
      setSyncProgress(null); // Clear progress when done
      setSyncStatus("idle");

      // Invalidate queries to refresh UI with pulled data
      if (result.pulled.folders > 0 || result.pulled.notes > 0) {
        queryClient.invalidateQueries({ queryKey: foldersQueryKey });
        queryClient.invalidateQueries({ queryKey: notesQueryKey });
      }

      if (result.errors.length > 0) {
        console.warn(
          "[SyncProvider] Sync completed with errors:",
          result.errors
        );
        scheduleRetry();
      }

      await refreshPendingCount();
    } catch (error) {
      console.error("[SyncProvider] Sync error:", error);
      setSyncProgress(null); // Clear progress on error
      setSyncStatus("error");
      scheduleRetry();
    }
  }, [syncService, refreshPendingCount, scheduleRetry, queryClient]);

  // Keep ref in sync with the latest sync function
  useEffect(() => {
    syncFnRef.current = sync;
  }, [sync]);

  // Sync a single note (for debounced saves)
  const syncNote = useCallback(
    async (docId: string) => {
      if (!syncService || !navigator.onLine) return;
      try {
        await syncService.syncNote(docId);
        await refreshPendingCount();
      } catch (error) {
        console.error("[SyncProvider] Note sync error:", error);
      }
    },
    [syncService, refreshPendingCount]
  );

  // Sync a single folder
  const syncFolder = useCallback(
    async (folderId: string) => {
      if (!syncService || !navigator.onLine) return;
      try {
        await syncService.syncFolder(folderId);
        await refreshPendingCount();
      } catch (error) {
        console.error("[SyncProvider] Folder sync error:", error);
      }
    },
    [syncService, refreshPendingCount]
  );

  // Delete a note from remote
  const deleteNoteRemote = useCallback(
    async (docId: string) => {
      if (!syncService) return;
      try {
        await syncService.deleteNoteRemote(docId);
      } catch (error) {
        console.error("[SyncProvider] Note delete error:", error);
      }
    },
    [syncService]
  );

  // Delete a folder from remote
  const deleteFolderRemote = useCallback(
    async (folderId: string) => {
      if (!syncService) return;
      try {
        await syncService.deleteFolderRemote(folderId);
      } catch (error) {
        console.error("[SyncProvider] Folder delete error:", error);
      }
    },
    [syncService]
  );

  // Online/offline handlers
  useEffect(() => {
    const handleOnline = () => {
      console.log("[SyncProvider] Network online, syncing...");
      setIsOnline(true);
      sync();
    };

    const handleOffline = () => {
      console.log("[SyncProvider] Network offline");
      setIsOnline(false);
      // Clear any pending retry
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [sync]);

  // Initial setup: migration + sync on mount + visibility handler (throttled)
  useEffect(() => {
    if (!syncService) return;

    // Run migration first, then initial sync
    const initialize = async () => {
      await runMigration();

      if (!hasInitialSynced.current) {
        hasInitialSynced.current = true;
        await refreshPendingCount();
        if (navigator.onLine) {
          sync();
        }
      }
    };

    initialize();

    // Sync when tab becomes visible (throttled to 60s to prevent excessive queries)
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        const now = Date.now();
        // 60 seconds throttle for auto-sync on visibility
        if (now - lastSyncAttempt.current > 60000) {
          console.debug("[SyncProvider] Tab visible, syncing (throttled)...");
          sync();
        } else {
          console.debug(
            "[SyncProvider] Tab visible but sync throttled (last sync < 60s ago)"
          );
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [syncService, sync, runMigration, refreshPendingCount]);

  const value: SyncContextType = {
    syncStatus,
    isOnline,
    pendingCount,
    lastSyncResult,
    syncProgress,
    sync,
    syncNote,
    syncFolder,
    deleteNoteRemote,
    deleteFolderRemote,
    syncService,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
