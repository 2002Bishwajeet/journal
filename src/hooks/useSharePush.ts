import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GetNotifications, MarkNotificationsAsRead, type DotYouClient } from '@homebase-id/js-lib/core';
import { useDotYouClientContext } from '@/components/auth';
import { JOURNAL_APP_ID, JOURNAL_PUSH_TYPE_SHARE, JOURNAL_PUSH_TYPE_UNSHARE } from '@/lib/homebase/config';
import type { SyncService } from '@/lib/homebase/SyncService';
import { usePeerAccess } from './usePeerAccess';
import { useSyncService } from './useSyncService';

/**
 * The recipient's side of a share push (#745) and an unshare push (#1494): the push only
 * says which owner to pull, or whose notes to check. The pull (#732) imports only what
 * that owner's server returns, so a forged senderId can at most cause one extra pull.
 */

const MAX_PARALLEL = 4;
const PAGE_SIZE = 100;

/** Pull an owner (a share push), or check the host's notes from them (an unshare push). */
export type OwnerSync = Pick<SyncService, 'pullOwnerNow' | 'revalidateOwner'>;

const isSharePush = (typeId: string | undefined) => typeId?.toLowerCase() === JOURNAL_PUSH_TYPE_SHARE;
const isUnsharePush = (typeId: string | undefined) => typeId?.toLowerCase() === JOURNAL_PUSH_TYPE_UNSHARE;

/** A message from the service worker (sw.ts relays each Journal push as `journal-push`, #744). */
export function pullOnSharePush(data: unknown, sync: OwnerSync): Promise<void> | undefined {
    const message = data as { type?: string; payload?: { senderId?: string; options?: { typeId?: string } } } | null;
    const senderId = message?.payload?.senderId;
    const typeId = message?.payload?.options?.typeId;
    if (message?.type !== 'journal-push' || !senderId) return;
    if (isSharePush(typeId)) return sync.pullOwnerNow(senderId);
    if (isUnsharePush(typeId)) return sync.revalidateOwner(senderId);
}

/**
 * Pushes that arrived while the app was closed, at most 4 owners at a time: a pull of each
 * owner with an unread SHARE entry, else a check of their notes for an unread UNSHARE entry
 * (a pull drops unshared notes too). An owner's entries are marked read only after that.
 */
export async function pullMissedSharePushes(client: DotYouClient, sync: OwnerSync): Promise<void> {
    const { results } = await GetNotifications(client, JOURNAL_APP_ID, PAGE_SIZE, undefined);
    const byOwner = new Map<string, { ids: string[]; share: boolean }>();
    for (const n of results) {
        const share = isSharePush(n.options?.typeId);
        if (!n.unread || !n.senderId || (!share && !isUnsharePush(n.options?.typeId))) continue;
        const entry = byOwner.get(n.senderId) ?? { ids: [], share: false };
        byOwner.set(n.senderId, { ids: [...entry.ids, n.id], share: entry.share || share });
    }
    const owners = [...byOwner.keys()];
    const read: string[] = [];
    for (let i = 0; i < owners.length; i += MAX_PARALLEL) {
        await Promise.all(owners.slice(i, i + MAX_PARALLEL).map(async (owner) => {
            const { ids, share } = byOwner.get(owner)!;
            try {
                if (share) await sync.pullOwnerNow(owner);
                else await sync.revalidateOwner(owner);
                read.push(...ids);
            } catch (error) {
                console.warn(`[SharePush] Pull from ${owner} failed; its push stays unread:`, error);
            }
        }));
    }
    if (read.length > 0) await MarkNotificationsAsRead(client, read);
}

/**
 * Acts on each share and unshare push: missed ones once per app open, then each one as it
 * arrives. Without peer access (#1494) it makes no peer call, and the pushes stay unread.
 */
export function useSharePush() {
    const client = useDotYouClientContext();
    const { syncService, lastSyncResult } = useSyncService();
    const canPeer = usePeerAccess() === true;
    const hasSynced = lastSyncResult !== null;

    useEffect(() => {
        if (!syncService || !hasSynced || !canPeer) return;
        pullMissedSharePushes(client, syncService)
            .catch((error) => console.warn('[SharePush] Could not read missed pushes:', error));
    }, [client, syncService, hasSynced, canPeer]);

    useEffect(() => {
        const sw = navigator.serviceWorker;
        if (!sw || !syncService || !canPeer) return;
        const onMessage = (event: MessageEvent) => {
            pullOnSharePush(event.data, syncService)
                ?.catch((error) => console.warn('[SharePush] Pull after a push failed:', error));
        };
        sw.addEventListener('message', onMessage);
        return () => sw.removeEventListener('message', onMessage);
    }, [syncService, canPeer]);
}

/**
 * A share notification opens `/shared/<noteId>?from=<owner>`. When the note is not here
 * yet, pull that owner first. True until that pull ends (the page shows a loader).
 */
export function useShareLinkPull(noteId: string | undefined, isLoading: boolean, isLocal: boolean): boolean {
    const [params] = useSearchParams();
    const from = params.get('from');
    const { syncService } = useSyncService();
    const canPeer = usePeerAccess();
    const key = from && noteId ? `${from}/${noteId}` : null;
    const [pulled, setPulled] = useState<string | null>(null);
    // Without peer access there is nothing to pull (#1494)
    const pending = !!key && !isLocal && pulled !== key && canPeer !== false;

    useEffect(() => {
        if (!pending || isLoading || !syncService || !from || !canPeer) return;
        syncService.pullOwnerNow(from)
            .catch((error) => console.warn('[SharePush] Pull for the opened note failed:', error))
            .finally(() => setPulled(key));
    }, [pending, isLoading, syncService, from, key, canPeer]);

    return pending;
}
