import { TAGS_SQL, updateSearchIndexMetadata, updateSyncStatus, NOTE_LIST_SQL } from '@/lib/db';
import { useLiveNoteList } from './useNotes';
import { useLiveQuery } from './useLiveQuery';
import type { DocumentMetadata } from '@/types';

export function useTags() {
    const { data, isLoading } = useLiveQuery<{ tag: string }>(TAGS_SQL, [], 'tag');

    const addTag = async (docId: string, tag: string, currentMetadata: DocumentMetadata) => {
        const normalizedTag = tag.toLowerCase().trim().replace(/^#/, '');
        const currentTags = currentMetadata.tags ?? [];
        if (!normalizedTag || currentTags.includes(normalizedTag)) return;

        const updatedMetadata = {
            ...currentMetadata,
            tags: [...currentTags, normalizedTag],
            timestamps: { ...currentMetadata.timestamps, modified: new Date().toISOString() },
        };

        await Promise.all([
            updateSearchIndexMetadata(docId, updatedMetadata.title, updatedMetadata),
            updateSyncStatus(docId, 'pending'),
        ]);
    };

    const removeTag = async (docId: string, tag: string, currentMetadata: DocumentMetadata) => {
        const updatedMetadata = {
            ...currentMetadata,
            tags: (currentMetadata.tags ?? []).filter(t => t !== tag),
            timestamps: { ...currentMetadata.timestamps, modified: new Date().toISOString() },
        };

        await Promise.all([
            updateSearchIndexMetadata(docId, updatedMetadata.title, updatedMetadata),
            updateSyncStatus(docId, 'pending'),
        ]);
    };

    return { tags: data.map(row => row.tag), isLoading, addTag, removeTag };
}

export function useNotesByTag(tag: string | null) {
    return useLiveNoteList(NOTE_LIST_SQL.byTag, [tag ?? ''], !!tag);
}
