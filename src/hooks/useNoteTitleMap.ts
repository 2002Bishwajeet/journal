import { useMemo } from 'react';
import { useLiveQuery } from './useLiveQuery';
import { NOTE_TITLE_MAP_SQL, NOTE_ROW_KEY } from '@/lib/db';
import type { NoteLinkResolution } from '@/components/editor/NoteLinkContext';

type TitleRow = { doc_id: string; title: string; folder_id: string; status: number };

/**
 * Live id → {title, folderId, status} map of every note, for resolving internal
 * link chips: current title (renames propagate), navigation target, and broken
 * state (id absent from the map). Backed by a PGlite live query so it stays fresh.
 */
export function useNoteTitleMap(): Map<string, NoteLinkResolution> {
    const { data: rows } = useLiveQuery<TitleRow>(NOTE_TITLE_MAP_SQL, [], NOTE_ROW_KEY);
    return useMemo(() => {
        const map = new Map<string, NoteLinkResolution>();
        for (const r of rows) {
            map.set(r.doc_id, {
                title: r.title || 'Untitled',
                folderId: r.folder_id,
                status: Number(r.status) || 0,
            });
        }
        return map;
    }, [rows]);
}
