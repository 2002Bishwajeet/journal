import { useEffect, useRef } from 'react';
import { isNativeApp } from '@/lib/native';

/**
 * Desktop app: when the tray menu's "New note" is picked, creates a note in the current
 * folder and opens it. The window may have been hidden; the webview and its sync keep
 * running. Does nothing on the web.
 */
export function useTrayNewNote(
    createAndOpen: (folderId: string | undefined) => Promise<void>,
    folderId: string | undefined,
): void {
    const latest = useRef(() => void createAndOpen(folderId));
    useEffect(() => {
        latest.current = () => void createAndOpen(folderId);
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
