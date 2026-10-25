import { useCallback, useEffect, useRef } from 'react';
import type { DotYouClient, NotificationType } from '@homebase-id/js-lib/core';
import { AppPermissionType, getConnections } from '@homebase-id/js-lib/network';
import { useDotYouClientContext } from '@/components/auth';
import { PeerPushSubscriptionProvider } from '@/lib/homebase/PeerPushSubscriptionProvider';
import { JOURNAL_DRIVE, JOURNAL_PEER_SUBSCRIPTION_ID } from '@/lib/homebase/config';
import { httpStatus } from '@/lib/homebase/httpStatus';
import { getAppState, saveAppState } from '@/lib/db/queries/appState';
import { useSecurityContext } from './securityContext/useSecurityContext';
import { useWebsocketSubscriber } from './useWebsocketSubscriber';

export const PEER_PUSH_LAST_RUN_KEY = 'peer_push_last_run';
export const PEER_PUSH_SUBSCRIBED_KEY = 'peer_push_subscribed';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PARALLEL = 4;

// Stable references so the websocket subscriber does not re-subscribe
const CONNECTION_CHANGE_TYPES: NotificationType[] = ['connectionRequestAccepted', 'connectionFinalized'];
// The app shares one socket, and js-lib refuses a second subscriber with other drives: use useJournalWebsocket's
const CONNECTION_DRIVES = [JOURNAL_DRIVE];

async function getAllConnectionIds(client: DotYouClient): Promise<Set<string>> {
    const ids = new Set<string>();
    let cursor: unknown;
    for (;;) {
        const page = await getConnections(client, { count: PAGE_SIZE, cursor });
        for (const c of page.results) ids.add(c.odinId.toLowerCase());
        if (page.results.length < PAGE_SIZE || page.cursor === undefined || page.cursor === null) break;
        cursor = page.cursor;
    }
    return ids;
}

/** Runs `task` for each item, a few at a time. Returns the items whose task failed. */
async function runLimited(items: string[], task: (item: string) => Promise<void>): Promise<string[]> {
    const failed: string[] = [];
    const queue = [...items];
    const worker = async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
            try {
                await task(item);
            } catch (error) {
                failed.push(item);
                console.warn('[PeerPush] Subscription call failed for', item, error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, items.length) }, worker));
    return failed;
}

/**
 * One pass: subscribe to each connection's Journal peer push (skipping ones already
 * subscribed) and drop subscriptions for identities that are no longer connections.
 * Skipped silently without `SendPushNotifications`. `force` ignores the once-a-day limit.
 */
export async function runPeerPushPass(
    client: DotYouClient,
    { hasPushPermission, force }: { hasPushPermission: boolean; force: boolean }
): Promise<void> {
    if (!hasPushPermission) return;
    const now = Date.now();
    if (!force) {
        const last = await getAppState<number>(PEER_PUSH_LAST_RUN_KEY);
        if (typeof last === 'number' && now - last < ONE_DAY_MS) return;
    }

    try {
        const provider = new PeerPushSubscriptionProvider(client);
        const connections = await getAllConnectionIds(client);
        // odin-core lists subscriptions only for apps with SendIntroductions, which Journal doesn't ask for.
        // Without the list, subscribe every connection (an upsert). Unsubscribe from the identities
        // this device subscribed earlier, which it keeps in app_state.
        const listed = await provider.list().catch((error) => {
            if (httpStatus(error) === 403) return undefined;
            throw error;
        });
        const stored = await getAppState<string[]>(PEER_PUSH_SUBSCRIBED_KEY);
        const tracked = Array.isArray(stored) ? stored : [];
        const subscribed = new Set(
            (listed ?? [])
                .filter((s) => s.subscriptionId?.toLowerCase() === JOURNAL_PEER_SUBSCRIPTION_ID)
                .map((s) => s.identity.toLowerCase())
        );

        const subscribeFailed = await runLimited(
            [...connections].filter((id) => !subscribed.has(id)),
            (id) => provider.subscribe(id)
        );
        const stale = [...new Set([...subscribed, ...tracked])].filter((id) => !connections.has(id));
        const unsubscribeFailed = await runLimited(stale, (id) => provider.unsubscribe(id));
        await saveAppState(PEER_PUSH_SUBSCRIBED_KEY, [
            ...[...connections].filter((id) => !subscribeFailed.includes(id)),
            ...unsubscribeFailed,
        ]);
        await saveAppState(PEER_PUSH_LAST_RUN_KEY, now);
    } catch (error) {
        console.warn('[PeerPush] Pass failed', error);
    }
}

/** Keeps Journal peer push subscribed for every connection (#743). */
export const usePeerPushSubscriptions = () => {
    const client = useDotYouClientContext();
    const { data: context } = useSecurityContext().fetch;
    const hasPushPermission =
        context?.permissionContext.permissionGroups.some((g) =>
            g.permissionSet.keys.includes(AppPermissionType.SendPushNotifications)
        ) ?? false;

    const running = useRef(false);
    const run = useCallback((force: boolean) => {
        if (running.current) return;
        running.current = true;
        runPeerPushPass(client, { hasPushPermission, force }).finally(() => {
            running.current = false;
        });
    }, [client, hasPushPermission]);
    // Stable, so the websocket subscriber doesn't re-subscribe on every render
    const onConnectionChange = useCallback(() => run(true), [run]);

    // Sign-in and app open: at most once a day
    useEffect(() => {
        if (hasPushPermission) run(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasPushPermission, client]);

    // A connection was added: run again now
    useWebsocketSubscriber(
        hasPushPermission ? onConnectionChange : undefined,
        undefined,
        CONNECTION_CHANGE_TYPES,
        CONNECTION_DRIVES,
        undefined,
        undefined,
        'usePeerPushSubscriptions'
    );
};
