import { useEffect } from 'react';

/**
 * Sets document.title for the current screen, resetting to "Journal" on
 * unmount so screens that don't set one never show a stale title.
 */
export function useDocumentTitle(title: string | null | undefined) {
    useEffect(() => {
        document.title = title ? `${title} · Journal` : 'Journal';
        return () => {
            document.title = 'Journal';
        };
    }, [title]);
}
