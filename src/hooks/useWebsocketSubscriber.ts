import {
    ApiType,
    Unsubscribe,
    Subscribe,
    Notify,
    DotYouClient,
} from '@homebase-id/js-lib/core';
import type {
    NotificationType,
    TargetDrive,
    TypedConnectionNotification,
} from '@homebase-id/js-lib/core';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useDotYouClientContext } from '@/components/auth';

/**
 * Wrapper for the notification subscriber within DotYouCore-js.
 * Adds client-side filtering of notifications by type.
 */
export const useWebsocketSubscriber = (
    handler:
        | ((dotYouClient: DotYouClient, notification: TypedConnectionNotification) => void)
        | undefined,
    types: NotificationType[],
    drives: TargetDrive[],
    onDisconnect?: () => void,
    onReconnect?: () => void,
    refId?: string
) => {
    const dotYouClient = useDotYouClientContext();
    const [isConnected, setIsConnected] = useState(false);
    const connectedHandler =
        useRef<((dotYouClient: DotYouClient, data: TypedConnectionNotification) => void) | null>(null);

    const wrappedHandler = useCallback(
        (dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {
            if (notification.notificationType === 'inboxItemReceived') {
                console.debug(
                    '[WebsocketSubscriber] Replying to inboxItemReceived by sending processInbox'
                );

                Notify({
                    command: 'processInbox',
                    data: JSON.stringify({
                        targetDrive: notification.targetDrive,
                        batchSize: 100,
                    }),
                });
            }

            // Filter by notification types if specified
            if (types?.length >= 1 && !types.includes(notification.notificationType)) return;
            handler?.(dotYouClient, notification);
        },
        [handler, types]
    );

    const localHandler = handler ? wrappedHandler : undefined;

    const subscribe = useCallback(
        async (handler: (dotYouClient: DotYouClient, data: TypedConnectionNotification) => void) => {
            connectedHandler.current = handler;

            try {
                await Subscribe(
                    dotYouClient,
                    drives,
                    handler,
                    () => {
                        setIsConnected(false);
                        onDisconnect?.();
                    },
                    () => {
                        setIsConnected(true);
                        onReconnect?.();
                    },
                    refId
                );
            } catch (error) {
                console.error('[WebsocketSubscriber] Subscribe failed:', error);
                setIsConnected(false);
                onDisconnect?.();
            }
        },
        [dotYouClient, drives, onDisconnect, onReconnect, refId]
    );

    const unsubscribe = useCallback(
        (handler: (dotYouClient: DotYouClient, data: TypedConnectionNotification) => void) => {
            try {
                Unsubscribe(handler);
            } catch (e) {
                console.error('[WebsocketSubscriber] Unsubscribe error:', e);
            }
        },
        []
    );

    useEffect(() => {
        if (
            (dotYouClient.getType() !== ApiType.Owner && dotYouClient.getType() !== ApiType.App) ||
            !dotYouClient.getSharedSecret() ||
            !localHandler
        )
            return;

        if (connectedHandler.current) {
            setIsConnected(false);
            unsubscribe(connectedHandler.current);
        }

        subscribe(localHandler).then(() => setIsConnected(true));

        return () => {
            setIsConnected(false);
            unsubscribe(localHandler);
        };
    }, [localHandler, dotYouClient, subscribe, unsubscribe]);

    return isConnected;
};
