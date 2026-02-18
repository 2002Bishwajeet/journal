import { useEffect } from 'react';
import { documentBroadcast, type DocumentBroadcastMessage } from '@/lib/broadcast';

/**
 * Hook to subscribe to document updates from various sources.
 * 
 * Updates flow through the DocumentBroadcast singleton:
 * - **BroadcastChannel**: Cross-tab updates from SyncService (pull sync)
 * - **WebSocket**: Real-time notifications are queued via WebSocketProcessQueue,
 *   which calls SyncService.handleRemoteNote → documentBroadcast.notifyDocumentUpdated.
 *   This means WebSocket updates automatically arrive here through the broadcast layer.
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

        const handleBroadcastMessage = (message: DocumentBroadcastMessage) => {
            if (
                message.type === 'update' &&
                message.docId === docId
            ) {
                console.debug(`[useDocumentSubscription] Received update for ${docId}`);
                onUpdate();
            }
        };

        const unsubscribe = documentBroadcast.subscribe(handleBroadcastMessage);

        return () => {
            unsubscribe();
        };
    }, [docId, onUpdate]);
}
