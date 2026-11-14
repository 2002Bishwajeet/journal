import { useEffect } from 'react';
import { runSearchReindex } from '@/lib/db/searchReindex';

const START_DELAY_MS = 20_000;

/**
 * Rebuilds the search vectors written before accent-insensitive search (#1229) once, a
 * while after the shell mounts, off the boot path. A no-op once every note is rebuilt.
 */
export function useSearchReindex(): void {
    useEffect(() => {
        const start = setTimeout(
            () => runSearchReindex().catch((error) => console.warn('[search] Search index rebuild failed:', error)),
            START_DELAY_MS,
        );
        return () => clearTimeout(start);
    }, []);
}
