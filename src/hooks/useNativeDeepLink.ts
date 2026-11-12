import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isNativeApp } from '@/lib/native';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { getDatabase } from '@/lib/db';
import { nativeDeepLinkRoute, parseNativeDeepLink, type NativeDeepLink } from '@/lib/nativeDeepLink';

// The last link handled, so a reload (sign-in, chunk reload) doesn't follow the launch link again.
const HANDLED_KEY = 'journal.nativeDeepLink.handled';

// A note that exists remotely may not have synced yet: look again for a few seconds before giving up.
const NOTE_WAIT_TRIES = 12;
const NOTE_WAIT_MS = 250;

/** The folder a note is in on this device, Main when it isn't here (the editor then says "Note not found"). */
async function noteFolderId(id: string): Promise<string> {
    for (let i = 0; i < NOTE_WAIT_TRIES; i++) {
        try {
            const db = await getDatabase();
            const result = await db.query<{ folder_id: string | null }>(
                `SELECT metadata->>'folderId' AS folder_id FROM search_index WHERE doc_id = $1`,
                [id],
            );
            if (result.rows[0]) return result.rows[0].folder_id ?? MAIN_FOLDER_ID;
        } catch {
            return MAIN_FOLDER_ID;
        }
        await new Promise((r) => setTimeout(r, NOTE_WAIT_MS));
    }
    return MAIN_FOLDER_ID;
}

/**
 * Native app: opens a note, today's note, the new-note screen or search for a
 * `journal://note|today|new|search` link the app was opened with (#1093), at cold
 * start (`getCurrent`) and while running (`onOpenUrl`). It only navigates. Signed
 * out, the AuthGuard keeps the target across sign-in. No-op on the web.
 */
export function useNativeDeepLink(): void {
    const navigate = useNavigate();
    useEffect(() => {
        if (!isNativeApp()) return;
        let stopped = false;
        let unlisten: (() => void) | undefined;

        const open = (urls: string[] | null, skipHandled: boolean) => {
            let link: NativeDeepLink | null = null;
            let url = '';
            for (const u of urls ?? []) {
                link = parseNativeDeepLink(u);
                if (link) {
                    url = u;
                    break;
                }
            }
            if (!link || (skipHandled && sessionStorage.getItem(HANDLED_KEY) === url)) return;
            sessionStorage.setItem(HANDLED_KEY, url);
            const target = link;
            const folder = target.kind === 'note' ? noteFolderId(target.id) : Promise.resolve(MAIN_FOLDER_ID);
            void folder.then((folderId) => {
                if (!stopped) navigate(nativeDeepLinkRoute(target, folderId));
            });
        };

        import('@tauri-apps/plugin-deep-link')
            .then(async ({ getCurrent, onOpenUrl }) => {
                const stop = await onOpenUrl((urls) => open(urls, false));
                if (stopped) return stop();
                unlisten = stop;
                open(await getCurrent(), true);
            })
            .catch((err: unknown) => console.error('[useNativeDeepLink] Failed to read deep links:', err));

        return () => {
            stopped = true;
            unlisten?.();
        };
    }, [navigate]);
}
