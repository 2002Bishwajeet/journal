import type { ClientFileNotification } from '@homebase-id/js-lib/core';

/**
 * A queued notification entry, keyed by uniqueId.
 * Stores the full notification along with its version identifiers
 * to support deduplication.
 */
interface QueueEntry {
    notification: ClientFileNotification;
    versionTag: string;
    updated: number;
}

type ProcessCallback = (notification: ClientFileNotification) => Promise<void>;

const DEFAULT_DEBOUNCE_MS = 700;

/**
 * WebSocketProcessQueue - Deduplicates and batches WebSocket notifications.
 *
 * Problem: Homebase WebSocket can fire duplicate notifications for the same file
 * (e.g., fileAdded followed by fileModified in quick succession).
 * Processing each one triggers expensive operations (DB lookups, Yjs merges, query invalidations).
 *
 * Solution: Queue notifications keyed by uniqueId. If a newer notification arrives
 * (higher versionTag or updated timestamp), it replaces the older one. After a
 * debounce window (default 700ms) with no new events, flush the queue and process
 * each unique entry once.
 *
 * This class is framework-agnostic (no React dependency) and can be used
 * in any JS environment.
 */
export class WebSocketProcessQueue {
    #queue: Map<string, QueueEntry> = new Map();
    #flushTimer: ReturnType<typeof setTimeout> | null = null;
    #onProcess: ProcessCallback;
    #debounceMs: number;
    #isFlushing = false;

    constructor(onProcess: ProcessCallback, debounceMs = DEFAULT_DEBOUNCE_MS) {
        this.#onProcess = onProcess;
        this.#debounceMs = debounceMs;
    }

    /**
     * Enqueue a WebSocket notification.
     * If the same uniqueId already exists in the queue, it is replaced only
     * when the incoming notification has a different versionTag or a newer updated timestamp.
     */
    enqueue(notification: ClientFileNotification): void {
        const uniqueId = notification.header?.fileMetadata?.appData?.uniqueId;
        if (!uniqueId) {
            console.warn('[ProcessQueue] Notification missing uniqueId, skipping', notification.notificationType);
            return;
        }

        const versionTag = notification.header?.fileMetadata?.versionTag ?? '';
        const updated = notification.header?.fileMetadata?.updated ?? 0;

        const existing = this.#queue.get(uniqueId);

        if (existing) {
            // Skip if we already have this exact version
            if (existing.versionTag === versionTag && existing.updated === updated) {
                console.debug(`[ProcessQueue] Skipping duplicate for ${uniqueId} (same versionTag + updated)`);
                return;
            }

            // Replace if incoming is newer or has a different version
            if (updated >= existing.updated) {
                console.debug(`[ProcessQueue] Replacing entry for ${uniqueId} (versionTag: ${existing.versionTag} → ${versionTag})`);
            } else {
                // Incoming is older — keep existing
                console.debug(`[ProcessQueue] Ignoring older entry for ${uniqueId}`);
                return;
            }
        } else {
            console.debug(`[ProcessQueue] Enqueued ${notification.notificationType} for ${uniqueId}`);
        }

        this.#queue.set(uniqueId, { notification, versionTag, updated });
        this.#scheduleFlush();
    }

    /**
     * Immediately process all queued items without waiting for the debounce timer.
     * Useful for disconnect/cleanup scenarios.
     */
    async drain(): Promise<void> {
        this.#clearTimer();
        await this.#flush();
    }

    /**
     * Get the current number of entries in the queue.
     */
    get size(): number {
        return this.#queue.size;
    }

    /**
     * Clean up timers. Does NOT flush — pending items are discarded.
     * Use drain() before destroy() if you want to process remaining items.
     */
    destroy(): void {
        this.#clearTimer();
        this.#queue.clear();
    }

    /**
     * Schedule a flush after the debounce window.
     * Resets the timer on each call (trailing-edge debounce).
     */
    #scheduleFlush(): void {
        this.#clearTimer();
        this.#flushTimer = setTimeout(() => {
            this.#flush().catch((error) => {
                console.error('[ProcessQueue] Flush error:', error);
            });
        }, this.#debounceMs);
    }

    #clearTimer(): void {
        if (this.#flushTimer !== null) {
            clearTimeout(this.#flushTimer);
            this.#flushTimer = null;
        }
    }

    /**
     * Process all queued entries sequentially.
     * The queue is drained atomically: we snapshot and clear before processing,
     * so new enqueues during processing start a fresh queue.
     */
    async #flush(): Promise<void> {
        if (this.#isFlushing || this.#queue.size === 0) return;

        this.#isFlushing = true;
        const snapshot = new Map(this.#queue);
        this.#queue.clear();

        console.debug(`[ProcessQueue] Flushing ${snapshot.size} entries`);

        try {
            for (const [uniqueId, entry] of snapshot) {
                try {
                    await this.#onProcess(entry.notification);
                } catch (error) {
                    console.error(`[ProcessQueue] Error processing ${uniqueId}:`, error);
                }
            }
        } finally {
            this.#isFlushing = false;

            // If new items arrived during flush, schedule another flush
            if (this.#queue.size > 0) {
                this.#scheduleFlush();
            }
        }
    }
}
