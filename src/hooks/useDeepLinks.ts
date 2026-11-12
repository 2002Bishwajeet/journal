import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { deepLinkRoute } from '@/lib/deepLink';
import { isNativeApp } from '@/lib/native';

// The last link handled, so a reload (sign-in, chunk reload) doesn't follow the launch link again.
const HANDLED_KEY = 'journal.deepLink.handled';

/**
 * Native app: opens the screen for a journal.cloudx.run or journal:// link the app
 * was opened with, at cold start (`getCurrent`) and while running (`onOpenUrl`).
 */
export function useDeepLinks(): void {
    const navigate = useNavigate();
    useEffect(() => {
        if (!isNativeApp()) return;
        let stopped = false;
        let unlisten: (() => void) | undefined;

        const open = (urls: string[] | null, skipHandled: boolean) => {
            const url = urls?.find((u) => deepLinkRoute(u) !== null);
            if (!url || (skipHandled && sessionStorage.getItem(HANDLED_KEY) === url)) return;
            sessionStorage.setItem(HANDLED_KEY, url);
            navigate(deepLinkRoute(url)!);
        };

        import('@tauri-apps/plugin-deep-link')
            .then(async ({ getCurrent, onOpenUrl }) => {
                const stop = await onOpenUrl((urls) => open(urls, false));
                if (stopped) return stop();
                unlisten = stop;
                open(await getCurrent(), true);
            })
            .catch((err: unknown) => console.error('[useDeepLinks] Failed to read deep links:', err));

        return () => {
            stopped = true;
            unlisten?.();
        };
    }, [navigate]);
}
