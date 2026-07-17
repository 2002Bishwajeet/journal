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
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useDotYouClientContext } from '@/components/auth';

// Peer module loaded on demand — most users never use collaboration
// (bundle-dynamic-imports)
type PeerModule = Awaited<typeof import('@homebase-id/js-lib/peer')>;

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
    const peerModuleRef = useRef<PeerModule | null>(null);

    const wrappedHandler = useCallback(
        (dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {
            if (notification.notificationType === 'inboxItemReceived') {
                console.debug(
                    '[WebsocketSubscriber] Replying to inboxItemReceived by sending processInbox'
                );

                const notifyPayload = {
                    command: 'processInbox' as const,
                    data: JSON.stringify({
                        targetDrive: notification.targetDrive,
                        batchSize: 100,
                    }),
                };

                if (isPeer && peerModuleRef.current) {
                    peerModuleRef.current.NotifyOverPeer(notifyPayload);
                } else {
                    Notify(notifyPayload);
                }
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

        let cancelled = false;

        const run = async () => {
            // Load peer module on demand when first needed (bundle-conditional)
            let peerMod = peerModuleRef.current;
            if (isPeer && !peerMod) {
                peerMod = await import('@homebase-id/js-lib/peer');
                peerModuleRef.current = peerMod;
            }

            if (cancelled) return;

            if (connectedHandler.current) {
                if (isPeer && peerMod) {
                    peerMod.UnsubscribeOverPeer(connectedHandler.current);
                } else {
                    Unsubscribe(connectedHandler.current);
                }
            }

            connectedHandler.current = localHandler;

            const disconnectCb = () => {
                if (!cancelled) setIsConnected(false);
                onDisconnectRef.current?.();
            };
            const reconnectCb = () => {
                if (!cancelled) setIsConnected(true);
                onReconnectRef.current?.();
            };

            try {
                if (isPeer && peerMod) {
                    await peerMod.SubscribeOverPeer(
                        dotYouClient,
                        odinId!,
                        drives,
                        localHandler,
                        disconnectCb,
                        reconnectCb,
                        undefined,
                        refId,
                    );
                } else {
                    await Subscribe(
                        dotYouClient,
                        drives,
                        localHandler,
                        disconnectCb,
                        reconnectCb,
                        undefined,
                        refId,
                        true, // useV2: authenticate the upgrade via odin.bearer subprotocol (cross-site capable)
                    );
                }
                if (!cancelled) setIsConnected(true);
            } catch (error: unknown) {
                console.error('[WebsocketSubscriber] Subscribe failed:', error);
                if (!cancelled) setIsConnected(false);
                onDisconnectRef.current?.();
            }
        };

        run();

        return () => {
            cancelled = true;
            setIsConnected(false);
            if (connectedHandler.current) {
                try {
                    if (isPeer && peerModuleRef.current) {
                        peerModuleRef.current.UnsubscribeOverPeer(connectedHandler.current);
                    } else if (!isPeer) {
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
