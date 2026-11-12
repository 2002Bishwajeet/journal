import { useEffect, useRef } from 'react';
import { isNativeApp } from '@/lib/native';

/**
 * Desktop app: runs `onNewNote` when the tray menu's "New note" is picked. The window
 * may have been hidden; the webview and its sync keep running. Does nothing on the web.
 */
export function useTrayNewNote(onNewNote: () => void): void {
    const latest = useRef(onNewNote);
    useEffect(() => {
        latest.current = onNewNote;
    });

    useEffect(() => {
        if (!isNativeApp()) return;
        let stopped = false;
        let unlisten: (() => void) | undefined;

        import('@premium')
            .then(({ listenTrayNewNote }) => listenTrayNewNote(() => latest.current()))
            .then((stop) => {
                if (stopped) stop();
                else unlisten = stop;
            })
            .catch((err: unknown) => console.error('[useTrayNewNote] Failed to listen:', err));

        return () => {
            stopped = true;
            unlisten?.();
        };
    }, []);
}
