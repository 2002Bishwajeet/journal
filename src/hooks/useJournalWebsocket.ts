import { useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DotYouClient, TypedConnectionNotification, DeletedHomebaseFile, ClientFileNotification } from '@homebase-id/js-lib/core';
import { drivesEqual } from '@homebase-id/js-lib/helpers';
import { useWebsocketSubscriber } from './useWebsocketSubscriber';
import { notesQueryKey } from './useNotes';
import { foldersQueryKey } from './useFolders';
import { toast } from 'sonner';
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    FOLDER_FILE_TYPE,
    COLLABORATION_INVITE_FILE_TYPE,
} from '@/lib/homebase';
import type { SyncService } from '@/lib/homebase/SyncService';
import type { NotificationType } from '@homebase-id/js-lib/core';
import { WebSocketProcessQueue } from '@/lib/sync';

// Stable references to prevent useWebsocketSubscriber from re-subscribing
const WS_NOTIFICATION_TYPES: NotificationType[] = ['fileAdded', 'fileModified', 'fileDeleted'];
const WS_DRIVES = [JOURNAL_DRIVE];

interface UseJournalWebsocketOptions {
    isEnabled: boolean;
    syncService: SyncService | null;
    onReconnect: () => Promise<void>;
}

/**
 * Journal-specific WebSocket handler.
 * Uses a process queue to deduplicate rapid-fire notifications
 * (e.g., same file triggering fileAdded + fileModified in quick succession).
 * Notifications are batched by uniqueId and flushed after 700ms of inactivity.
 */
export const useJournalWebsocket = ({ isEnabled, syncService, onReconnect }: UseJournalWebsocketOptions) => {
    const queryClient = useQueryClient();
    const disconnectTimeRef = useRef<number | null>(null);
    // Queue is created once in an effect — not during render
    const queueRef = useRef<WebSocketProcessQueue | null>(null);

    const processNotification = useCallback(async (notification: ClientFileNotification) => {
        if (!syncService) {
            console.warn('[JournalWebsocket] SyncService not available during queue flush');
            return;
        }

        try {
            if (
                (notification.notificationType === 'fileAdded' ||
                notification.notificationType === 'fileModified' ||
                notification.notificationType === 'statisticsChanged') &&
                drivesEqual(notification.targetDrive, JOURNAL_DRIVE)
            ) {
                const fileType = notification.header?.fileMetadata?.appData?.fileType;
                if (fileType === JOURNAL_FILE_TYPE) {
                    await syncService.handleRemoteNote(notification.header);
                    queryClient.invalidateQueries({ queryKey: notesQueryKey });
                } else if (fileType === FOLDER_FILE_TYPE) {
                    await syncService.handleRemoteFolder(notification.header);
                    queryClient.invalidateQueries({ queryKey: foldersQueryKey });
                } else if (fileType === COLLABORATION_INVITE_FILE_TYPE) {
                    await syncService.handleInvitation(notification.header);
                    queryClient.invalidateQueries({ queryKey: notesQueryKey });
                    const content = notification.header?.fileMetadata?.appData?.content;
                    if (content) {
                        try {
                            const invite = typeof content === 'string' ? JSON.parse(content) : content;
                            if (invite.authorOdinId && invite.noteTitle) {
                                toast(`${invite.authorOdinId.split('.')[0]} shared "${invite.noteTitle}" with you`);
                            }
                        } catch { /* ignore parse errors for toast */ }
                    }
                }
            } else if (notification.notificationType === 'fileDeleted') {
                const fileType = notification.header?.fileMetadata?.appData?.fileType;
                if (fileType === JOURNAL_FILE_TYPE) {
                    await syncService.handleDeletedNote(
                        notification.header as unknown as DeletedHomebaseFile,
                    );
                    queryClient.invalidateQueries({ queryKey: notesQueryKey });
                } else if (fileType === FOLDER_FILE_TYPE) {
                    await syncService.handleDeletedFolder(
                        notification.header as unknown as DeletedHomebaseFile,
                    );
                    queryClient.invalidateQueries({ queryKey: foldersQueryKey });
                } else if (fileType === COLLABORATION_INVITE_FILE_TYPE) {
                    await syncService.handleDeletedInvitation(
                        notification.header as unknown as DeletedHomebaseFile,
                    );
                    queryClient.invalidateQueries({ queryKey: notesQueryKey });
                }
            }
        } catch (error) {
            console.error('[JournalWebsocket] Error processing queued notification:', error);
        }
    }, [syncService, queryClient]);


    const processNotificationRef = useRef(processNotification);
    useEffect(() => {
        processNotificationRef.current = processNotification;
    }, [processNotification]);


    useEffect(() => {
        queueRef.current = new WebSocketProcessQueue((n) => processNotificationRef.current(n));
        return () => {
            queueRef.current?.destroy();
            queueRef.current = null;
        };
    }, []);

    const handleNotification = useCallback(
        async (_dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {

            console.debug('[JournalWebsocket] Received notification:', notification.notificationType);

            if (
                notification.notificationType === 'fileAdded' ||
                notification.notificationType === 'fileModified' ||
                notification.notificationType === 'statisticsChanged' || notification.notificationType === 'fileDeleted'
            ) {
                queueRef.current?.enqueue(notification);
            }
        },
        []
    );

    const handleDisconnect = useCallback(() => {
        console.debug('[JournalWebsocket] Disconnected');
        disconnectTimeRef.current = Date.now();

        // Drain remaining queued items before disconnect
        queueRef.current?.drain().catch((error: unknown) => {
            console.error('[JournalWebsocket] Error draining queue on disconnect:', error);
        });
    }, []);

    const handleReconnect = useCallback(() => {
        console.debug('[JournalWebsocket] Reconnected');
        if (disconnectTimeRef.current) {
            onReconnect();
            disconnectTimeRef.current = null;
        }
    }, [onReconnect]);

    return useWebsocketSubscriber(
        isEnabled ? handleNotification : undefined,
        undefined,
        WS_NOTIFICATION_TYPES,
        WS_DRIVES,
        handleDisconnect,
        handleReconnect,
        'useJournalWebsocket'
    );
};
