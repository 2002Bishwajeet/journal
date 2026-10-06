import { TAGS_SQL, updateSearchIndexMetadata, updateSyncStatus, NOTE_LIST_SQL, deleteTagFromAllNotes } from '@/lib/db';
import { useLiveNoteList } from './useNotes';
import { useLiveQuery } from './useLiveQuery';
import type { DocumentMetadata } from '@/types';

export function useTags() {
    const { data, isLoading } = useLiveQuery<{ tag: string; count: number }>(TAGS_SQL, [], 'tag');

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

    /** Remove a tag from every note that has it; each changed note is marked pending. */
    const deleteTag = async (tag: string) => {
        await deleteTagFromAllNotes(tag);
    };

    return {
        tags: data.map(row => row.tag),
        tagCounts: Object.fromEntries(data.map(row => [row.tag, row.count])),
        isLoading,
        addTag,
        removeTag,
        deleteTag,
    };
}

export function useNotesByTag(tag: string | null) {
    return useLiveNoteList(NOTE_LIST_SQL.byTag, [tag ?? ''], !!tag);
}
