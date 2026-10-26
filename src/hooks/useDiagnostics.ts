import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/auth/useAuth';
import { useSyncService } from '@/hooks/useSyncService';
import { useOnlineContext } from '@/hooks/useOnlineContext';
import { useDeviceType } from '@/hooks/useDeviceType';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { formatBytes, useStorageInfo } from '@/hooks/useStorageInfo';
import {
    clearRetryBackoff,
    getAppState,
    getDatabaseInfo,
    getPendingSyncItems,
    retryPendingImageUploadNow,
    type DatabaseInfo,
    type PendingSyncItem,
} from '@/lib/db';
import { SHARED_PULL_STATE_KEY } from '@/lib/homebase/sync/sharedPull';
import { getShareNotificationsOffHosts, subscribeShareNotifications } from '@/lib/homebase/shareNotifications';
import { ownerConsoleDriveUrl } from '@/lib/homebase/config';
import { useDotYouClientContext } from '@/components/auth';
import { appendLog, getLogSnapshot, subscribeLog } from '@/lib/diagnostics/logBuffer';
import { buildReport, type StatusRow } from '@/lib/diagnostics/report';
import { formatRelativeTime } from '@/lib/utils';

interface DeviceFacts {
    serviceWorker: string;
    database: DatabaseInfo | null;
    sharedPassAt: number | null;
}

async function describeServiceWorker(): Promise<string> {
    if (!('serviceWorker' in navigator)) return 'not supported';
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return 'not registered';
    if (registration.waiting) return 'update waiting';
    if (registration.installing) return 'installing';
    return registration.active?.state ?? 'not active';
}

async function loadDeviceFacts(): Promise<DeviceFacts> {
    const [serviceWorker, database, shared] = await Promise.all([
        describeServiceWorker().catch(() => 'unknown'),
        getDatabaseInfo().catch(() => null),
        getAppState<{ fullPassAt?: number }>(SHARED_PULL_STATE_KEY).catch(() => null),
    ]);
    return { serviceWorker, database, sharedPassAt: shared?.fullPassAt ?? null };
}

function formatWhen(time: Date | number | null): string {
    if (time === null) return 'never';
    const date = new Date(time);
    return `${date.toISOString()} (${formatRelativeTime(date)})`;
}

/**
 * Everything Settings → Diagnostics shows (#800): the pending sync items with their
 * errors, the recent log, a status block, and the actions that retry or share them.
 */
export function useDiagnostics() {
    const { syncStatus, pendingCount, lastSyncedAt, websocketConnected, sync, syncNote, syncFolder } = useSyncService();
    const { isOnline } = useOnlineContext();
    const { getIdentity } = useAuth();
    const client = useDotYouClientContext();
    const { status: pushStatus } = usePushNotifications();
    const { usage, quota } = useStorageInfo();
    const isMobile = useDeviceType() === 'mobile';

    const [items, setItems] = useState<PendingSyncItem[] | null>(null);
    const [facts, setFacts] = useState<DeviceFacts | null>(null);
    const [reloadCount, setReloadCount] = useState(0);
    const [retrying, setRetrying] = useState<string | null>(null);
    const [includeTitles, setIncludeTitles] = useState(false);
    const log = useSyncExternalStore(subscribeLog, getLogSnapshot);
    const shareNotificationsOff = useSyncExternalStore(subscribeShareNotifications, getShareNotificationsOffHosts)
        .includes(client.getHostIdentity());

    // Re-read the list whenever a sync finishes or the count moves, and after a retry.
    const listKey = `${pendingCount.total}:${syncStatus}:${lastSyncedAt?.getTime() ?? 0}:${reloadCount}`;
    useEffect(() => {
        let cancelled = false;
        getPendingSyncItems()
            .then((next) => {
                if (!cancelled) setItems(next);
            })
            .catch((error) => console.error('[Diagnostics] Could not read pending items:', error));
        return () => {
            cancelled = true;
        };
    }, [listKey]);

    useEffect(() => {
        let cancelled = false;
        loadDeviceFacts().then((next) => {
            if (!cancelled) setFacts(next);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const status: StatusRow[] = [
        { label: 'App version', value: `v${__APP_VERSION__} (build ${__APP_BUILD__})` },
        { label: 'Identity', value: getIdentity() || 'unknown' },
        { label: 'Network', value: isOnline ? 'online' : 'offline' },
        { label: 'Realtime connection', value: websocketConnected ? 'connected' : 'disconnected' },
        { label: 'Sync', value: syncStatus },
        { label: 'Last full sync', value: formatWhen(lastSyncedAt) },
        { label: 'Last shared notes pass', value: formatWhen(facts?.sharedPassAt ?? null) },
        { label: 'Push notifications', value: pushStatus },
        ...(shareNotificationsOff ? [{ label: 'Share notifications', value: 'off: the journal drive does not allow subscriptions' }] : []),
        { label: 'Service worker', value: facts?.serviceWorker ?? 'checking' },
        {
            label: 'Database',
            value: facts?.database
                ? `${facts.database.engine}${facts.database.sizeBytes === null ? '' : ` · ${formatBytes(facts.database.sizeBytes)}`}`
                : 'unknown',
        },
        {
            label: 'Browser storage',
            value: usage === null ? 'unknown' : `${formatBytes(usage)}${quota === null ? '' : ` of ${formatBytes(quota)}`}`,
        },
    ];

    const reload = () => setReloadCount((count) => count + 1);

    const retryAll = async () => {
        await clearRetryBackoff();
        appendLog('info', '[Diagnostics] Retry now for the whole queue');
        await sync();
        reload();
    };

    const retryItem = async (item: PendingSyncItem) => {
        setRetrying(item.id);
        try {
            await clearRetryBackoff(item.id);
            appendLog('info', `[Diagnostics] Retry now for ${item.kind} ${item.id}`);
            if (item.kind === 'image') {
                await retryPendingImageUploadNow(item.id);
                await sync();
            } else if (item.isDelete) {
                await sync();
            } else if (item.kind === 'note') {
                await syncNote(item.id);
            } else {
                await syncFolder(item.id);
            }
        } finally {
            setRetrying(null);
            reload();
        }
    };

    const reportText = () => buildReport({ status, items: items ?? [], log, includeTitles });

    const copyReport = async () => {
        try {
            await navigator.clipboard.writeText(reportText());
            toast.success('Copied diagnostics');
        } catch {
            toast.error("Couldn't copy to clipboard");
        }
    };

    const canShare = isMobile && typeof navigator.share === 'function';
    const shareReport = async () => {
        try {
            await navigator.share({ title: 'Journal diagnostics', text: reportText() });
        } catch (error) {
            // Dismissing the share sheet rejects with AbortError; that is not a failure.
            if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error("Couldn't open the share sheet");
        }
    };

    return {
        status,
        // Set once a share push was refused (#817); the fix is a switch on the owner console.
        shareNotificationsFixUrl: shareNotificationsOff ? ownerConsoleDriveUrl(client.getRoot()) : null,
        items,
        log,
        isSyncing: syncStatus === 'syncing',
        isOnline,
        retrying,
        retryAll,
        retryItem,
        includeTitles,
        setIncludeTitles,
        copyReport,
        canShare,
        shareReport,
    };
}
