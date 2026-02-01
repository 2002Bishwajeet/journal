import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DotYouClient, TypedConnectionNotification, HomebaseFile, DeletedHomebaseFile, NotificationType } from '@homebase-id/js-lib/core';
import { drivesEqual } from '@homebase-id/js-lib/helpers';
import { useWebsocketSubscriber } from './useWebsocketSubscriber';
import { useSyncService } from './useSyncService';
import { notesQueryKey } from './useNotes';
import { foldersQueryKey } from './useFolders';
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    FOLDER_FILE_TYPE,
    websocketDrives,
} from '@/lib/homebase';
import type { NoteFileContent, FolderFile } from '@/types';

// Type guard to check if the notification has file-related properties
type FileNotification = TypedConnectionNotification & {
    targetDrive: { alias: string; type: string };
    header: HomebaseFile<string>;
};

function isFileNotification(notification: TypedConnectionNotification): notification is FileNotification {
    return 'targetDrive' in notification && 'header' in notification;
}

const NOTIFICATION_TYPES = ['fileAdded', 'fileModified', 'fileDeleted'] as const;

/**
 * Journal-specific WebSocket handler.
 * Processes real-time notifications for notes and folders,
 * directly updating local state via SyncService handlers.
 */
export const useJournalWebsocket = (isEnabled: boolean) => {
    const queryClient = useQueryClient();
    const { syncService, sync } = useSyncService();
    const disconnectTimeRef = useRef<number | null>(null);

    const handleNotification = useCallback(
        async (_dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {
            // Only process file-related notifications
            if (!isFileNotification(notification)) {
                return;
            }

            // Only process notifications for JOURNAL_DRIVE
            if (!drivesEqual(notification.targetDrive, JOURNAL_DRIVE)) {
                return;
            }

            if (!syncService) {
                console.warn('[JournalWebsocket] SyncService not available');
                return;
            }

            const fileType = notification.header?.fileMetadata?.appData?.fileType;

            console.debug('[JournalWebsocket] Received notification:', notification.notificationType, fileType);

            try {
                if (
                    notification.notificationType === 'fileAdded' ||
                    notification.notificationType === 'fileModified'
                ) {
                    if (fileType === JOURNAL_FILE_TYPE) {
                        await syncService.handleRemoteNote(
                            notification.header as unknown as HomebaseFile<NoteFileContent>
                        );
                        queryClient.invalidateQueries({ queryKey: notesQueryKey });
                    } else if (fileType === FOLDER_FILE_TYPE) {
                        await syncService.handleRemoteFolder(
                            notification.header as unknown as HomebaseFile<FolderFile>
                        );
                        queryClient.invalidateQueries({ queryKey: foldersQueryKey });
                    }
                } else if (notification.notificationType === 'fileDeleted') {
                    if (fileType === JOURNAL_FILE_TYPE) {
                        await syncService.handleDeletedNote(
                            notification.header as unknown as DeletedHomebaseFile
                        );
                        queryClient.invalidateQueries({ queryKey: notesQueryKey });
                    } else if (fileType === FOLDER_FILE_TYPE) {
                        await syncService.handleDeletedFolder(
                            notification.header as unknown as DeletedHomebaseFile
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
            sync();
            disconnectTimeRef.current = null;
        }
    }, [sync]);

    return useWebsocketSubscriber(
        isEnabled ? handleNotification : undefined,
        NOTIFICATION_TYPES as unknown as NotificationType[],
        websocketDrives,
        handleDisconnect,
        handleReconnect,
        'useJournalWebsocket'
    );
};
