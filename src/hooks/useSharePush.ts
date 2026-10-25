import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GetNotifications, MarkNotificationsAsRead, type DotYouClient } from '@homebase-id/js-lib/core';
import { useDotYouClientContext } from '@/components/auth';
import { JOURNAL_APP_ID, JOURNAL_PUSH_TYPE_SHARE } from '@/lib/homebase/config';
import { useSyncService } from './useSyncService';

/**
 * The recipient's side of a share push (#745): the push only says which owner to pull.
 * The pull (#732) imports only what that owner's server returns, so a forged senderId
 * can at most cause one extra pull.
 */

const MAX_PARALLEL = 4;
const PAGE_SIZE = 100;

type PullOwner = (odinId: string) => Promise<void>;

const isSharePush = (typeId: string | undefined) => typeId?.toLowerCase() === JOURNAL_PUSH_TYPE_SHARE;

/** A message from the service worker (sw.ts relays each Journal push as `journal-push`, #744). */
export function pullOnSharePush(data: unknown, pullOwner: PullOwner): Promise<void> | undefined {
    const message = data as { type?: string; payload?: { senderId?: string; options?: { typeId?: string } } } | null;
    const senderId = message?.payload?.senderId;
    if (message?.type !== 'journal-push' || !senderId || !isSharePush(message.payload?.options?.typeId)) return;
    return pullOwner(senderId);
}

/**
 * Share pushes that arrived while the app was closed: one pull per owner with an unread
 * SHARE entry, at most 4 at a time. An owner's entries are marked read only after its pull.
 */
export async function pullMissedSharePushes(client: DotYouClient, pullOwner: PullOwner): Promise<void> {
    const { results } = await GetNotifications(client, JOURNAL_APP_ID, PAGE_SIZE, undefined);
    const idsByOwner = new Map<string, string[]>();
    for (const n of results) {
        if (!n.unread || !n.senderId || !isSharePush(n.options?.typeId)) continue;
        idsByOwner.set(n.senderId, [...(idsByOwner.get(n.senderId) ?? []), n.id]);
    }
    const owners = [...idsByOwner.keys()];
    const read: string[] = [];
    for (let i = 0; i < owners.length; i += MAX_PARALLEL) {
        await Promise.all(owners.slice(i, i + MAX_PARALLEL).map(async (owner) => {
            try {
                await pullOwner(owner);
                read.push(...idsByOwner.get(owner)!);
            } catch (error) {
                console.warn(`[SharePush] Pull from ${owner} failed; its push stays unread:`, error);
            }
        }));
    }
    if (read.length > 0) await MarkNotificationsAsRead(client, read);
}

/** Pulls the owner of each share push: missed ones once per app open, then each one as it arrives. */
export function useSharePush() {
    const client = useDotYouClientContext();
    const { syncService, lastSyncResult } = useSyncService();
    const hasSynced = lastSyncResult !== null;

    useEffect(() => {
        if (!syncService || !hasSynced) return;
        pullMissedSharePushes(client, (odinId) => syncService.pullOwnerNow(odinId))
            .catch((error) => console.warn('[SharePush] Could not read missed pushes:', error));
    }, [client, syncService, hasSynced]);

    useEffect(() => {
        const sw = navigator.serviceWorker;
        if (!sw || !syncService) return;
        const onMessage = (event: MessageEvent) => {
            pullOnSharePush(event.data, (odinId) => syncService.pullOwnerNow(odinId))
                ?.catch((error) => console.warn('[SharePush] Pull after a push failed:', error));
        };
        sw.addEventListener('message', onMessage);
        return () => sw.removeEventListener('message', onMessage);
    }, [syncService]);
}

/**
 * A share notification opens `/shared/<noteId>?from=<owner>`. When the note is not here
 * yet, pull that owner first. True until that pull ends (the page shows a loader).
 */
export function useShareLinkPull(noteId: string | undefined, isLoading: boolean, isLocal: boolean): boolean {
    const [params] = useSearchParams();
    const from = params.get('from');
    const { syncService } = useSyncService();
    const key = from && noteId ? `${from}/${noteId}` : null;
    const [pulled, setPulled] = useState<string | null>(null);
    const pending = !!key && !isLocal && pulled !== key;

    useEffect(() => {
        if (!pending || isLoading || !syncService || !from) return;
        syncService.pullOwnerNow(from)
            .catch((error) => console.warn('[SharePush] Pull for the opened note failed:', error))
            .finally(() => setPulled(key));
    }, [pending, isLoading, syncService, from, key]);

    return pending;
}
