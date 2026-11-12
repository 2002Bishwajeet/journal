import { useEffect } from 'react';
import { nativePlatform } from '@/lib/native';

/** Windows and Linux desktop app: Ctrl+Q quits, since closing the window only hides it. macOS has Cmd+Q. */
export function useQuitShortcut(): void {
    const platform = nativePlatform();
    const applies = platform === 'windows' || platform === 'linux';

    useEffect(() => {
        if (!applies) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'q') {
                e.preventDefault();
                void import('@premium').then(({ quitApp }) => quitApp());
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [applies]);
}
