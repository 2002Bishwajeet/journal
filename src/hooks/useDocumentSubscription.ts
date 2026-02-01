import { useEffect } from 'react';
import { documentBroadcast, type DocumentBroadcastMessage } from '@/lib/broadcast';

/**
 * Hook to subscribe to document updates from various sources (BroadcastChannel, WebSocket).
 * 
 * @param docId - The unique ID of the document to watch.
 * @param onUpdate - Callback function triggered when an update occurs.
 */
export function useDocumentSubscription(
    docId: string,
    onUpdate: () => void
): void {
    useEffect(() => {
        if (!docId) return;

        /**
         * Handle BroadcastChannel messages (from SyncService)
         */
        const handleBroadcastMessage = (message: DocumentBroadcastMessage) => {
            // Check for specific document update or global flush
            if (
                message.type === 'update' &&
                message.docId === docId
            ) {
                console.debug(`[useDocumentSubscription] Received broadcast update for ${docId}`);
                onUpdate();
            }
        };

        // Subscribe to BroadcastChannel
        const unsubscribeBroadcast = documentBroadcast.subscribe(handleBroadcastMessage);

        /**
         * Future: WebSocket Subscription
         * 
         * // Example implementation:
         * const handleSocketMessage = (event: any) => {
         *     if (event.docId === docId && event.type === 'update') {
         *         onUpdate();
         *     }
         * };
         * socket.on('document:update', handleSocketMessage);
         */

        return () => {
            unsubscribeBroadcast();

            // Future: Unsubscribe from WebSocket
            // socket.off('document:update', handleSocketMessage);
        };
    }, [docId, onUpdate]);
}
