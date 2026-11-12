import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { retrieveIdentity } from '@homebase-id/js-lib/auth';
import { useLiveQuery } from '@/hooks/useLiveQuery';
import { todayTitle } from '@/hooks/useDailyNote';
import { getActiveNoteByTitle, NOTE_LIST_SQL } from '@/lib/db';
import { hasNativePlugin, invokeNative } from '@/lib/native';
import {
    BRIDGE_PLUGIN,
    BRIDGE_RECENT_LIMIT,
    buildBridgeSnapshot,
    checkBridgeIdentity,
    getShowNotesOutsideApp,
    notesVisibleOutsideApp,
    setShowNotesOutsideApp,
    subscribeNotesVisibility,
    type BridgeAction,
    type BridgeLicense,
} from '@/lib/native/bridge';
import { importBridgeActions } from '@/lib/native/bridgeImport';

/** Edits and sync pulls come in bursts: write the snapshot once they settle. */
export const SNAPSHOT_DEBOUNCE_MS = 2000;

const RECENT_SQL = `${NOTE_LIST_SQL.active} LIMIT ${BRIDGE_RECENT_LIMIT}`;

interface RecentRow {
    doc_id: string;
    title: string;
    preview: string | null;
    metadata: { timestamps?: { modified?: string } };
}

const isForeground = () => document.visibilityState === 'visible';

/**
 * Native app with the bridge plugin: mirrors the snapshot for widgets, intents, Spotlight
 * and watch apps (debounced, after every edit or sync, and on return to the app), and
 * imports the actions they queued on launch and on return to the app. `license` gates
 * the import. Does nothing on the web and in the public build.
 */
export function useNativeBridge(license: BridgeLicense): void {
    const enabled = hasNativePlugin(BRIDGE_PLUGIN);
    const visible = useSyncExternalStore(subscribeNotesVisibility, notesVisibleOutsideApp);
    const navigate = useNavigate();
    // BrowserRouter's navigate changes with every route; draining only follows launch and foreground.
    const navigateRef = useRef(navigate);
    useEffect(() => {
        navigateRef.current = navigate;
    });
    // Primitives, so a caller's fresh licence object doesn't rewrite or drain on every render.
    const { state, trialEndsAt, updatesUntil } = license;
    // A live query re-emits on every local edit and sync write.
    const { data: rows, isLoading } = useLiveQuery<RecentRow>(RECENT_SQL, [], 'doc_id', enabled);

    useEffect(() => {
        const identity = retrieveIdentity();
        if (enabled && identity) void checkBridgeIdentity(identity);
    }, [enabled]);

    useEffect(() => {
        if (!enabled || isLoading) return;
        const current: BridgeLicense = { state, trialEndsAt, updatesUntil };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const write = async () => {
            const now = new Date();
            const today = await getActiveNoteByTitle(todayTitle(now));
            const snapshot = buildBridgeSnapshot({
                now,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                visible,
                license: current,
                todayId: today?.docId ?? null,
                recent: rows.map((row) => ({
                    id: row.doc_id,
                    title: row.title,
                    text: row.preview ?? '',
                    modified: row.metadata.timestamps?.modified ?? now.toISOString(),
                })),
            });
            await invokeNative(BRIDGE_PLUGIN, 'bridge_write_snapshot', { snapshot });
        };
        const schedule = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                write().catch((err: unknown) => console.error('[useNativeBridge] Snapshot write failed:', err));
            }, SNAPSHOT_DEBOUNCE_MS);
        };
        // Back in the app: "today" may have rolled over while it was away.
        const onForeground = () => {
            if (isForeground()) schedule();
        };
        schedule();
        document.addEventListener('visibilitychange', onForeground);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onForeground);
        };
    }, [enabled, isLoading, rows, visible, state, trialEndsAt, updatesUntil]);

    useEffect(() => {
        if (!enabled) return;
        const current: BridgeLicense = { state, trialEndsAt, updatesUntil };
        let draining = false;
        const drain = async () => {
            if (draining) return;
            draining = true;
            try {
                const actions = (await invokeNative<BridgeAction[]>(BRIDGE_PLUGIN, 'bridge_take_actions')) ?? [];
                const { ack, open } = await importBridgeActions(actions, current);
                if (ack.length > 0) await invokeNative(BRIDGE_PLUGIN, 'bridge_ack', { ids: ack });
                if (open) navigateRef.current(`/${open.folderId}/${open.docId}`);
            } catch (err) {
                console.error('[useNativeBridge] Draining actions failed:', err);
            } finally {
                draining = false;
            }
        };
        const onForeground = () => {
            if (isForeground()) void drain();
        };
        void drain();
        document.addEventListener('visibilitychange', onForeground);
        return () => document.removeEventListener('visibilitychange', onForeground);
    }, [enabled, state, trialEndsAt, updatesUntil]);
}

/** Settings -> Security "Show notes outside the app". */
export function useShowNotesOutsideApp() {
    const on = useSyncExternalStore(subscribeNotesVisibility, getShowNotesOutsideApp);
    return { on, setOn: setShowNotesOutsideApp };
}
