import * as Y from 'yjs';
import { saveDocumentUpdate, getDocumentUpdates, replaceDocumentUpdates } from '@/lib/db';
import { documentBroadcast, type DocumentBroadcastMessage } from '@/lib/broadcast';

// Origin tagged on updates that come FROM the database (load/reload). The update
// handler skips it: replaying stored state is not a new edit, and persisting it
// again cost one full-document INSERT plus a compaction rewrite on every open.
const DB_ORIGIN = 'db';

/**
 * Custom Yjs provider that persists to PGlite
 * Handles loading and saving Yjs updates to the local database
 * Also listens for external updates via DocumentBroadcast (e.g., from SyncService)
 */
export class PGliteProvider {
    private doc: Y.Doc;
    private docId: string;
    private isLoaded: boolean = false;
    private isSaving: boolean = false;
    private pendingUpdates: Uint8Array[] = [];
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private updateCount: number = 0;
    private static readonly COMPACTION_THRESHOLD = 50; // Compact after 50 updates
    // Trailing write window: keystrokes within it are merged into one row.
    private static readonly WRITE_WINDOW_MS = 300;
    private unsubscribe: (() => void) | null = null;

    constructor(docId: string, doc: Y.Doc) {
        this.docId = docId;
        this.doc = doc;

        // Listen for local updates
        this.doc.on('update', this.handleUpdate);

        // Subscribe to broadcast messages
        this.unsubscribe = documentBroadcast.subscribe(this.handleBroadcastMessage);

        // Best-effort: persist the open write window when the tab is hidden or unloaded
        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', this.handlePageHide);
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }

    private handlePageHide = (): void => {
        void this.flush();
    };

    private handleVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') void this.flush();
    };

    /**
     * Handle broadcast messages from DocumentBroadcast singleton
     */
    private handleBroadcastMessage = async (message: DocumentBroadcastMessage): Promise<void> => {
        if (message.type === 'flush') {
            // Flush all providers when sync starts (docId may be undefined for global flush)
            if (!message.docId || message.docId === this.docId) {
                await this.flush();
            }
            return;
        }

        if (message.type === 'update') {
            if (message.docId !== this.docId) return;
            // Reload updates from DB and apply any new ones
            await this.reloadFromDb();
        }
    };

    /**
     * Reload document state from database (called when external update is detected)
     * This is triggered by BroadcastChannel when SyncService updates the document
     * (e.g., after image upload completes and updates src attribute)
     */
    private async reloadFromDb(): Promise<void> {
        try {
            const updates = await getDocumentUpdates(this.docId);

            // Apply all updates - Yjs handles deduplication internally
            // We can't use diffUpdate here because it doesn't reliably detect
            // attribute changes (like src or data-pending-id modifications)
            for (const update of updates) {
                Y.applyUpdate(this.doc, update, 'remote');
            }
            this.updateCount = updates.length;
        } catch (error) {
            console.error('[PGliteProvider] Failed to reload from DB:', error);
        }
    }

    /**
     * Load existing updates from PGlite and apply to doc
     */
    async load(): Promise<void> {
        if (this.isLoaded) return;

        try {
            const updates = await getDocumentUpdates(this.docId);
            this.updateCount = updates.length;

            // Apply all stored updates to the document
            for (const update of updates) {
                Y.applyUpdate(this.doc, update, DB_ORIGIN);
            }

            this.isLoaded = true;

            // Auto-compact on load if there are many updates
            if (this.updateCount > PGliteProvider.COMPACTION_THRESHOLD) {
                console.debug(`[PGliteProvider] ${this.updateCount} updates found, compacting...`);
                await this.compact();
            }
        } catch (error) {
            console.error('[PGliteProvider] Failed to load updates:', error);
            throw error;
        }
    }

    /**
     * Handle Yjs document updates
     */
    private handleUpdate = (update: Uint8Array, origin: unknown): void => {
        // Skip updates from remote (Homebase sync) to avoid duplication, and
        // updates this provider just applied from the database (load/reload) —
        // writing those back is pure amplification, not a new edit.
        if (origin === 'remote' || origin === DB_ORIGIN) return;

        // Queue the update
        this.pendingUpdates.push(update);

        // The first update of a burst opens the write window. While a save is in
        // flight its drain loop picks the update up instead.
        if (!this.isSaving && !this.saveTimer) {
            this.saveTimer = setTimeout(() => void this.drain(), PGliteProvider.WRITE_WINDOW_MS);
        }
    };

    /**
     * Write everything queued as one merged row per pass.
     */
    private async drain(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.isSaving) return; // the in-flight drain loop will write the queue

        this.isSaving = true;
        let saved = false;
        try {
            // Re-drain: updates queued while an earlier batch was awaiting its
            // save would otherwise strand in memory (isSaving stays true, so no
            // new window is opened). Loop until the queue is empty so the
            // last keystrokes of a burst are always persisted.
            while (this.pendingUpdates.length > 0) {
                const updates = this.pendingUpdates;
                this.pendingUpdates = [];

                await saveDocumentUpdate(this.docId, Y.mergeUpdates(updates));
                this.updateCount++;
                saved = true;
            }

            // One announcement per drained burst, so another tab open on
            // this note reloads it. Its reload applies with origin 'remote',
            // which the guard in handleUpdate skips, so it is never re-announced.
            if (saved) documentBroadcast.notifyOtherTabs(this.docId);

            // Auto-compact if threshold reached
            if (this.updateCount >= PGliteProvider.COMPACTION_THRESHOLD) {
                await this.compact();
            }
        } catch (error) {
            console.error('[PGliteProvider] Failed to save update:', error);
        } finally {
            this.isSaving = false;
            // Updates that arrived during compaction (or a failed save) open a new window
            if (this.pendingUpdates.length > 0 && !this.saveTimer) {
                this.saveTimer = setTimeout(() => void this.drain(), PGliteProvider.WRITE_WINDOW_MS);
            }
        }
    }

    /**
     * Flush all pending updates to the database.
     * Call this before sync operations to ensure no updates are lost.
     */
    async flush(): Promise<void> {
        // Write the open window now instead of waiting for its timer
        await this.drain();

        // Wait for any in-progress save to complete
        while (this.isSaving) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Updates that arrived while that save was compacting were not in its loop
        if (this.pendingUpdates.length > 0) await this.drain();
    }

    /**
     * Compact all updates into a single update blob
     * This significantly reduces memory and storage usage
     */
    async compact(): Promise<void> {
        try {
            // Get the full merged state
            const mergedState = Y.encodeStateAsUpdate(this.doc);

            // Atomically swap all existing updates for the single compacted blob
            await replaceDocumentUpdates(this.docId, mergedState);

            this.updateCount = 1;
            console.log(`[PGliteProvider] Compacted updates for doc ${this.docId}`);
        } catch (error) {
            console.error('[PGliteProvider] Failed to compact updates:', error);
        }
    }

    /**
     * Get the current state vector (for sync)
     */
    getStateVector(): Uint8Array {
        return Y.encodeStateVector(this.doc);
    }

    /**
     * Get all updates since a state vector (for sync)
     */
    getUpdatesSince(stateVector: Uint8Array): Uint8Array {
        return Y.encodeStateAsUpdate(this.doc, stateVector);
    }

    /**
     * Apply remote updates (from Homebase sync)
     */
    applyRemoteUpdate(update: Uint8Array): void {
        Y.applyUpdate(this.doc, update, 'remote');
    }

    /**
     * Get full state as single update (for Homebase storage)
     */
    getFullState(): Uint8Array {
        return Y.encodeStateAsUpdate(this.doc);
    }

    /**
     * Destroy the provider and compact updates
     */
    async destroy(): Promise<void> {
        this.doc.off('update', this.handleUpdate);

        // Unsubscribe from broadcast messages
        this.unsubscribe?.();
        this.unsubscribe = null;

        if (typeof window !== 'undefined') {
            window.removeEventListener('pagehide', this.handlePageHide);
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        }

        // Persist any pending/in-flight updates first so they survive teardown even
        // when the note has <= 1 stored update (below the compaction threshold).
        await this.flush();

        // Compact on destroy to save memory for next load
        if (this.updateCount > 1) {
            await this.compact();
        }
    }
}
