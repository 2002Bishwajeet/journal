import { useMemo } from 'react';
import { useLiveQuery } from './useLiveQuery';
import { NOTE_TITLE_MAP_SQL, NOTE_ROW_KEY } from '@/lib/db';
import type { NoteLinkResolution } from '@/components/editor/NoteLinkContext';

type TitleRow = { doc_id: string; title: string; folder_id: string };

/**
 * Live id → {title, folderId} map of every ACTIVE note, for resolving internal
 * link chips: current title (renames propagate) and navigation target. `isReady`
 * distinguishes "still loading" from "target genuinely missing", so a valid chip
 * isn't flashed as broken before the subscription's first emission.
 */
export function useNoteTitleMap(): { map: Map<string, NoteLinkResolution>; isReady: boolean } {
    const { data: rows, isLoading } = useLiveQuery<TitleRow>(NOTE_TITLE_MAP_SQL, [], NOTE_ROW_KEY);
    const map = useMemo(() => {
        const m = new Map<string, NoteLinkResolution>();
        for (const r of rows) {
            m.set(r.doc_id, { title: r.title || 'Untitled', folderId: r.folder_id });
        }
        return m;
    }, [rows]);
    return { map, isReady: !isLoading };
}
