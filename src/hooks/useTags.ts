import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllTags, getNotesForListByTag, updateSearchIndexMetadata, updateSyncStatus } from '@/lib/db';
import { notesQueryKey } from './useNotes';
import type { NoteListEntry, DocumentMetadata } from '@/types';

export const tagsQueryKey = ['tags'] as const;

export function useTags() {
    const queryClient = useQueryClient();

    const tagsQuery = useQuery<string[]>({
        queryKey: tagsQueryKey,
        queryFn: getAllTags,
    });

    const addTag = async (docId: string, tag: string, currentMetadata: DocumentMetadata) => {
        const normalizedTag = tag.toLowerCase().trim().replace(/^#/, '');
        if (!normalizedTag || currentMetadata.tags.includes(normalizedTag)) return;

        const updatedMetadata = {
            ...currentMetadata,
            tags: [...currentMetadata.tags, normalizedTag],
            timestamps: { ...currentMetadata.timestamps, modified: new Date().toISOString() },
        };

        await Promise.all([
            updateSearchIndexMetadata(docId, updatedMetadata.title, updatedMetadata),
            updateSyncStatus(docId, 'pending'),
        ]);

        queryClient.invalidateQueries({ queryKey: notesQueryKey });
        queryClient.invalidateQueries({ queryKey: tagsQueryKey });
    };

    const removeTag = async (docId: string, tag: string, currentMetadata: DocumentMetadata) => {
        const updatedMetadata = {
            ...currentMetadata,
            tags: currentMetadata.tags.filter(t => t !== tag),
            timestamps: { ...currentMetadata.timestamps, modified: new Date().toISOString() },
        };

        await Promise.all([
            updateSearchIndexMetadata(docId, updatedMetadata.title, updatedMetadata),
            updateSyncStatus(docId, 'pending'),
        ]);

        queryClient.invalidateQueries({ queryKey: notesQueryKey });
        queryClient.invalidateQueries({ queryKey: tagsQueryKey });
    };

    return { tags: tagsQuery.data ?? [], isLoading: tagsQuery.isLoading, addTag, removeTag };
}

export function useNotesByTag(tag: string | null) {
    return useQuery<NoteListEntry[]>({
        queryKey: [...notesQueryKey, 'tag', tag],
        queryFn: () => getNotesForListByTag(tag!),
        enabled: !!tag,
    });
}
