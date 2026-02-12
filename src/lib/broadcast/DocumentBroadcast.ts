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
        if (typeof BroadcastChannel === 'undefined') {
            console.warn('[DocumentBroadcast] BroadcastChannel not available');
            return;
        }

        this.channel = new BroadcastChannel(DOC_BROADCAST_CHANNEL);
        console.debug('[DocumentBroadcast] Channel initialized', { channel: DOC_BROADCAST_CHANNEL });
        this.channel.onmessage = async (event) => {
            const message = event.data as DocumentBroadcastMessage;
            console.debug('[DocumentBroadcast] Message received', message);

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
        console.debug('[DocumentBroadcast] Handler subscribed', { handlerCount: this.handlers.size });
        return () => {
            this.handlers.delete(handler);
            console.debug('[DocumentBroadcast] Handler unsubscribed', { handlerCount: this.handlers.size });
        };
    }

    private dispatchLocal(message: DocumentBroadcastMessage): void {
        for (const handler of this.handlers) {
            try {
                const result = handler(message);
                if (result instanceof Promise) {
                    result.catch((error) => {
                        console.error('[DocumentBroadcast] Handler error:', error);
                    });
                }
            } catch (error) {
                console.error('[DocumentBroadcast] Handler error:', error);
            }
        }
    }

    /**
     * Notify that a document was updated in the database.
     * Active editors should reload the document.
     */
    notifyDocumentUpdated(docId: string): void {
        const message: DocumentBroadcastMessage = { type: 'update', docId };
        console.debug('[DocumentBroadcast] notifyDocumentUpdated', { docId });
        this.dispatchLocal(message);
        if (!this.channel) {
            console.warn('[DocumentBroadcast] notifyDocumentUpdated called without channel', { docId });
            return;
        }
        this.channel.postMessage(message);
    }

    /**
     * Request all providers to flush pending updates to the database.
     * @param docId - Optional. If provided, only that document's provider flushes.
     */
    requestFlush(docId?: string): void {
        const message: DocumentBroadcastMessage = { type: 'flush', docId };
        console.debug('[DocumentBroadcast] requestFlush', { docId });
        this.dispatchLocal(message);
        if (!this.channel) {
            console.warn('[DocumentBroadcast] requestFlush called without channel', { docId });
            return;
        }
        this.channel.postMessage(message);
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
