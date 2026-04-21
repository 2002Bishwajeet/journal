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
import {
    SubscribeOverPeer,
    UnsubscribeOverPeer,
    NotifyOverPeer,
} from '@homebase-id/js-lib/peer';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useDotYouClientContext } from '@/components/auth';

export const useWebsocketSubscriber = (
    handler:
        | ((dotYouClient: DotYouClient, notification: TypedConnectionNotification) => void)
        | undefined,
    odinId: string | undefined,
    types: NotificationType[],
    drives: TargetDrive[],
    onDisconnect?: () => void,
    onReconnect?: () => void,
    refId?: string
) => {
    const dotYouClient = useDotYouClientContext();
    const isPeer = useMemo(() => !!odinId && odinId !== dotYouClient.getHostIdentity(), [odinId, dotYouClient]);
    const [isConnected, setIsConnected] = useState(false);
    const connectedHandler =
        useRef<((dotYouClient: DotYouClient, data: TypedConnectionNotification) => void) | null>(null);

    const wrappedHandler = useCallback(
        (dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {
            if (notification.notificationType === 'inboxItemReceived') {
                console.debug(
                    '[WebsocketSubscriber] Replying to inboxItemReceived by sending processInbox'
                );

                const notifyFn = isPeer ? NotifyOverPeer : Notify;
                notifyFn({
                    command: 'processInbox',
                    data: JSON.stringify({
                        targetDrive: notification.targetDrive,
                        batchSize: 100,
                    }),
                });
            }

            if (types?.length >= 1 && !types.includes(notification.notificationType)) return;
            handler?.(dotYouClient, notification);
        },
        [handler, types, isPeer]
    );

    const localHandler = handler ? wrappedHandler : undefined;

    const onDisconnectRef = useRef(onDisconnect);
    const onReconnectRef = useRef(onReconnect);
    useEffect(() => {
        onDisconnectRef.current = onDisconnect;
        onReconnectRef.current = onReconnect;
    }, [onDisconnect, onReconnect]);

    useEffect(() => {
        if (
            (dotYouClient.getType() !== ApiType.Owner && dotYouClient.getType() !== ApiType.App) ||
            !dotYouClient.getSharedSecret() ||
            !localHandler
        )
            return;

        if (connectedHandler.current) {
            if (isPeer) {
                UnsubscribeOverPeer(connectedHandler.current);
            } else {
                Unsubscribe(connectedHandler.current);
            }
        }

        connectedHandler.current = localHandler;
        let cancelled = false;

        const disconnectCb = () => {
            if (!cancelled) setIsConnected(false);
            onDisconnectRef.current?.();
        };
        const reconnectCb = () => {
            if (!cancelled) setIsConnected(true);
            onReconnectRef.current?.();
        };

        const subscribePromise = isPeer
            ? SubscribeOverPeer(
                  dotYouClient,
                  odinId!,
                  drives,
                  localHandler,
                  disconnectCb,
                  reconnectCb,
                  undefined,
                  refId
              )
            : Subscribe(
                  dotYouClient,
                  drives,
                  localHandler,
                  disconnectCb,
                  reconnectCb,
                  undefined,
                  refId
              );

        subscribePromise
            .then(() => {
                if (!cancelled) setIsConnected(true);
            })
            .catch((error: unknown) => {
                console.error('[WebsocketSubscriber] Subscribe failed:', error);
                if (!cancelled) setIsConnected(false);
                onDisconnectRef.current?.();
            });

        return () => {
            cancelled = true;
            setIsConnected(false);
            if (connectedHandler.current) {
                try {
                    if (isPeer) {
                        UnsubscribeOverPeer(connectedHandler.current);
                    } else {
                        Unsubscribe(connectedHandler.current);
                    }
                } catch (e) {
                    console.error('[WebsocketSubscriber] Unsubscribe error:', e);
                }
            }
        };
    }, [localHandler, dotYouClient, drives, refId, isPeer, odinId]);

    return isConnected;
};
