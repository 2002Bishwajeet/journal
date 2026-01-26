/**
 * DocumentBroadcast - Singleton for cross-tab/component document synchronization.
 * 
 * Handles communication between SyncService and active PGliteProviders using BroadcastChannel.
 * This centralizes all broadcast messaging for cleaner code.
 */

export const DOC_BROADCAST_CHANNEL = 'journal-doc-updates';

export type DocumentBroadcastMessage =
    | { type: 'update'; docId: string }      // Document was updated in DB, editor should reload
    | { type: 'flush'; docId?: string };     // Request to flush pending updates (docId optional for global flush)

type MessageHandler = (message: DocumentBroadcastMessage) => void | Promise<void>;

class DocumentBroadcast {
    private static instance: DocumentBroadcast | null = null;
    private channel: BroadcastChannel | null = null;
    private handlers: Set<MessageHandler> = new Set();

    private constructor() {
        this.initChannel();
    }

    /**
     * Get the singleton instance
     */
    static getInstance(): DocumentBroadcast {
        if (!DocumentBroadcast.instance) {
            DocumentBroadcast.instance = new DocumentBroadcast();
        }
        return DocumentBroadcast.instance;
    }

    /**
     * Initialize the BroadcastChannel
     */
    private initChannel(): void {
        if (typeof BroadcastChannel === 'undefined') return;

        this.channel = new BroadcastChannel(DOC_BROADCAST_CHANNEL);
        this.channel.onmessage = async (event) => {
            const message = event.data as DocumentBroadcastMessage;

            // Notify all registered handlers
            for (const handler of this.handlers) {
                try {
                    await handler(message);
                } catch (error) {
                    console.error('[DocumentBroadcast] Handler error:', error);
                }
            }
        };
    }

    /**
     * Subscribe to broadcast messages.
     * Returns an unsubscribe function.
     */
    subscribe(handler: MessageHandler): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    /**
     * Notify that a document was updated in the database.
     * Active editors should reload the document.
     */
    notifyDocumentUpdated(docId: string): void {
        this.channel?.postMessage({ type: 'update', docId });
    }

    /**
     * Request all providers to flush pending updates to the database.
     * @param docId - Optional. If provided, only that document's provider flushes.
     */
    requestFlush(docId?: string): void {
        this.channel?.postMessage({ type: 'flush', docId });
    }

    /**
     * Request flush and wait for providers to complete.
     * Use this before sync operations.
     */
    async requestFlushAndWait(docId?: string, waitMs = 50): Promise<void> {
        this.requestFlush(docId);
        // Give providers time to flush (they run async)
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    /**
     * Close the channel (for cleanup)
     */
    destroy(): void {
        this.channel?.close();
        this.channel = null;
        this.handlers.clear();
        DocumentBroadcast.instance = null;
    }
}

// Export singleton accessor
export const documentBroadcast = DocumentBroadcast.getInstance();
