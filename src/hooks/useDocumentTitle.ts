import { useEffect } from 'react';

/**
 * Sets document.title for the current screen. No cleanup — the next screen
 * that mounts sets its own title.
 */
export function useDocumentTitle(title: string | null | undefined) {
    useEffect(() => {
        document.title = title ? `${title} · Journal` : 'Journal';
    }, [title]);
}
