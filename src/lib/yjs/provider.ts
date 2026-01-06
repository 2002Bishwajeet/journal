import * as Y from 'yjs';
import { saveDocumentUpdate, getDocumentUpdates, deleteDocumentUpdates } from '@/lib/db';

/**
 * Custom Yjs provider that persists to PGlite
 * Handles loading and saving Yjs updates to the local database
 */
export class PGliteProvider {
    private doc: Y.Doc;
    private docId: string;
    private isLoaded: boolean = false;
    private isSaving: boolean = false;
    private pendingUpdates: Uint8Array[] = [];
    private updateCount: number = 0;
    private static readonly COMPACTION_THRESHOLD = 50; // Compact after 50 updates

    constructor(docId: string, doc: Y.Doc) {
        this.docId = docId;
        this.doc = doc;

        // Listen for local updates
        this.doc.on('update', this.handleUpdate);
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
                Y.applyUpdate(this.doc, update);
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
    private handleUpdate = async (update: Uint8Array, origin: unknown): Promise<void> => {
        // Skip updates from remote (Homebase sync) to avoid duplication
        if (origin === 'remote') return;

        // Queue the update
        this.pendingUpdates.push(update);

        // Debounce save operations
        if (!this.isSaving) {
            this.isSaving = true;

            // Use microtask to batch multiple updates
            queueMicrotask(async () => {
                try {
                    const updates = [...this.pendingUpdates];
                    this.pendingUpdates = [];

                    // Save each update to the database
                    for (const u of updates) {
                        await saveDocumentUpdate(this.docId, u);
                        this.updateCount++;
                    }

                    // Auto-compact if threshold reached
                    if (this.updateCount >= PGliteProvider.COMPACTION_THRESHOLD) {
                        await this.compact();
                    }
                } catch (error) {
                    console.error('[PGliteProvider] Failed to save update:', error);
                } finally {
                    this.isSaving = false;
                }
            });
        }
    };

    /**
     * Compact all updates into a single update blob
     * This significantly reduces memory and storage usage
     */
    async compact(): Promise<void> {
        try {
            // Get the full merged state
            const mergedState = Y.encodeStateAsUpdate(this.doc);

            // Delete all existing updates
            await deleteDocumentUpdates(this.docId);

            // Save the single compacted update
            await saveDocumentUpdate(this.docId, mergedState);

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

        // Compact on destroy to save memory for next load
        if (this.updateCount > 1) {
            await this.compact();
        }
    }
}
