import { useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DotYouClient, TypedConnectionNotification, NotificationType, TargetDrive, DeletedHomebaseFile } from '@homebase-id/js-lib/core';
import { drivesEqual } from '@homebase-id/js-lib/helpers';
import { useWebsocketSubscriber } from './useWebsocketSubscriber';
import { notesQueryKey } from './useNotes';
import { JOURNAL_DRIVE, JOURNAL_FILE_TYPE } from '@/lib/homebase';
import type { SyncService } from '@/lib/homebase/SyncService';
import { toast } from 'sonner';

const PEER_WS_TYPES: NotificationType[] = ['fileAdded', 'fileModified', 'fileDeleted'];
const PEER_WS_DRIVES: TargetDrive[] = [JOURNAL_DRIVE];

interface UsePeerNoteWebsocketOptions {
    authorOdinId: string | undefined;
    noteUniqueId: string | undefined;
    isEnabled: boolean;
    syncService: SyncService | null;
}

export const usePeerNoteWebsocket = ({
    authorOdinId,
    noteUniqueId,
    isEnabled,
    syncService,
}: UsePeerNoteWebsocketOptions) => {
    const queryClient = useQueryClient();
    const disconnectTimeRef = useRef<number | null>(null);

    // Refs for stable callbacks — avoids WebSocket resubscription on prop changes
    // (rerender-use-ref-transient-values)
    const syncServiceRef = useRef(syncService);
    const noteUniqueIdRef = useRef(noteUniqueId);
    const authorOdinIdRef = useRef(authorOdinId);
    useEffect(() => {
        syncServiceRef.current = syncService;
        noteUniqueIdRef.current = noteUniqueId;
        authorOdinIdRef.current = authorOdinId;
    }, [syncService, noteUniqueId, authorOdinId]);

    const handleNotification = useCallback(
        async (_dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {
            if (!syncServiceRef.current || !noteUniqueIdRef.current) return;

            const fileUniqueId = notification.header?.fileMetadata?.appData?.uniqueId;
            if (fileUniqueId !== noteUniqueIdRef.current) return;

            if (!drivesEqual(notification.targetDrive, JOURNAL_DRIVE)) return;
            if (notification.header?.fileMetadata?.appData?.fileType !== JOURNAL_FILE_TYPE) return;

            if (notification.notificationType === 'fileAdded' || notification.notificationType === 'fileModified') {
                await syncServiceRef.current.handleRemoteNote(notification.header);
                queryClient.invalidateQueries({ queryKey: notesQueryKey });
            } else if (notification.notificationType === 'fileDeleted') {
                await syncServiceRef.current.handleDeletedNote(notification.header as unknown as DeletedHomebaseFile);
                queryClient.invalidateQueries({ queryKey: notesQueryKey });
                toast('This shared note has been deleted by the author');
            }
        },
        [queryClient],
    );

    const handleDisconnect = useCallback(() => {
        disconnectTimeRef.current = Date.now();
    }, []);

    const handleReconnect = useCallback(async () => {
        if (!syncServiceRef.current || !noteUniqueIdRef.current || !authorOdinIdRef.current) return;
        disconnectTimeRef.current = null;
        try {
            const freshFile = await syncServiceRef.current.getNoteProvider().getNote(
                noteUniqueIdRef.current, authorOdinIdRef.current, { decrypt: false },
            );
            if (freshFile) {
                await syncServiceRef.current.handleRemoteNote(freshFile);
                queryClient.invalidateQueries({ queryKey: notesQueryKey });
            }
        } catch (error) {
            console.error('[PeerNoteWebsocket] Reconnect sync failed:', error);
        }
    }, [queryClient]);

    const shouldSubscribe = isEnabled && !!authorOdinId && !!noteUniqueId;

    return useWebsocketSubscriber(
        shouldSubscribe ? handleNotification : undefined,
        authorOdinId,
        PEER_WS_TYPES,
        PEER_WS_DRIVES,
        handleDisconnect,
        handleReconnect,
        `peer-note-${noteUniqueId}`,
    );
};
