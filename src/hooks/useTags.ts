import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllTags, updateSearchIndexMetadata, updateSyncStatus, NOTE_LIST_SQL } from '@/lib/db';
import { useLiveNoteList } from './useNotes';
import type { DocumentMetadata } from '@/types';

export const tagsQueryKey = ['tags'] as const;

export function useTags() {
    const queryClient = useQueryClient();

    const tagsQuery = useQuery<string[]>({
        queryKey: tagsQueryKey,
        queryFn: getAllTags,
    });

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

        // The note list is a live query (auto-updates); only the derived tag list
        // still needs a manual refresh.
        queryClient.invalidateQueries({ queryKey: tagsQueryKey });
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

        queryClient.invalidateQueries({ queryKey: tagsQueryKey });
    };

    return { tags: tagsQuery.data ?? [], isLoading: tagsQuery.isLoading, addTag, removeTag };
}

export function useNotesByTag(tag: string | null) {
    return useLiveNoteList(NOTE_LIST_SQL.byTag, [tag ?? ''], !!tag);
}
