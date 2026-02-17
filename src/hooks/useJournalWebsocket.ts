import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DotYouClient, TypedConnectionNotification, DeletedHomebaseFile } from '@homebase-id/js-lib/core';
import { drivesEqual } from '@homebase-id/js-lib/helpers';
import { useWebsocketSubscriber } from './useWebsocketSubscriber';
import { notesQueryKey } from './useNotes';
import { foldersQueryKey } from './useFolders';
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    FOLDER_FILE_TYPE,
} from '@/lib/homebase';
import type { SyncService } from '@/lib/homebase/SyncService';
import type { NotificationType } from '@homebase-id/js-lib/core';

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
 * Processes real-time notifications for notes and folders,
 * directly updating local state via SyncService handlers.
 */
export const useJournalWebsocket = ({ isEnabled, syncService, onReconnect }: UseJournalWebsocketOptions) => {
    const queryClient = useQueryClient();
    const disconnectTimeRef = useRef<number | null>(null);

    const handleNotification = useCallback(
        async (_dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {
            if (!syncService) {
                console.warn('[JournalWebsocket] SyncService not available');
                return;
            }

            console.debug('[JournalWebsocket] Received notification:', notification);

            try {
                if (
                    notification.notificationType === 'fileAdded' ||
                    notification.notificationType === 'fileModified' ||
                    notification.notificationType === 'statisticsChanged' &&
                    drivesEqual(notification.targetDrive, JOURNAL_DRIVE)
                ) {
                    const fileType = notification.header?.fileMetadata?.appData?.fileType;
                    if (fileType === JOURNAL_FILE_TYPE) {
                        await syncService.handleRemoteNote(
                            notification.header,
                        );
                        queryClient.invalidateQueries({ queryKey: notesQueryKey });
                    } else if (fileType === FOLDER_FILE_TYPE) {
                        await syncService.handleRemoteFolder(
                            notification.header,
                        );
                        queryClient.invalidateQueries({ queryKey: foldersQueryKey });
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
                    }
                }
            } catch (error) {
                console.error('[JournalWebsocket] Error processing notification:', error);
            }
        },
        [syncService, queryClient]
    );

    const handleDisconnect = useCallback(() => {
        console.log('[JournalWebsocket] Disconnected');
        disconnectTimeRef.current = Date.now();
    }, []);

    const handleReconnect = useCallback(() => {
        console.log('[JournalWebsocket] Reconnected');
        // Trigger delta sync to catch any missed changes during disconnect
        if (disconnectTimeRef.current) {
            console.log('[JournalWebsocket] Triggering delta sync after reconnect');
            onReconnect();
            disconnectTimeRef.current = null;
        }
    }, [onReconnect]);

    return useWebsocketSubscriber(
        isEnabled ? handleNotification : undefined,
        WS_NOTIFICATION_TYPES,
        WS_DRIVES,
        handleDisconnect,
        handleReconnect,
        'useJournalWebsocket'
    );
};
