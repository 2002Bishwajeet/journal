import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDotYouClientContext } from '@/components/auth';
import { AgentGrantsDriveProvider } from '@/lib/homebase/AgentGrantsDriveProvider';
import {
    type AgentAccess,
    type AgentGrants,
    EMPTY_GRANTS,
    folderAccess as getFolderAccess,
    resolveAccess,
    setFolderAccess,
    setNoteAccess,
} from '@/lib/agent/grants';
import type { Folder, NoteListEntry } from '@/types';

export const AGENT_GRANTS_QUERY_KEY = ['agent-grants'] as const;

interface AgentGrantsQueryData {
    grants: AgentGrants;
    versionTag?: string;
    fileId?: string;
}

export type AgentAccessMutation =
    | { type: 'folder'; folderId: string; access: AgentAccess }
    | { type: 'note'; noteId: string; access: AgentAccess | null };

/** Applies one grant change to `current`. Never mutates. Exported for tests. */
export function nextGrantsFor(current: AgentGrants, mutation: AgentAccessMutation): AgentGrants {
    return mutation.type === 'folder'
        ? setFolderAccess(current, mutation.folderId, mutation.access)
        : setNoteAccess(current, mutation.noteId, mutation.access);
}

export interface AgentAccessNoteRow {
    noteId: string;
    title: string;
    access: AgentAccess;
    override: AgentAccess | null;
    locked: boolean;
}

export interface AgentAccessFolderRow {
    folderId: string;
    name: string;
    access: AgentAccess;
    notes: AgentAccessNoteRow[];
}

/**
 * Pure view-model builder for the Agent access settings screen: one row per folder,
 * each carrying its effective access and (when notes are supplied) its notes' effective
 * access, override, and whether it's locked by excludeFromAI. Exported for tests
 * (src/__tests__/agentGrantsSettings.test.ts) and used by AgentAccessSection.
 */
export function buildAgentAccessRows(
    grants: AgentGrants,
    folders: ReadonlyArray<Folder>,
    notesByFolder: Record<string, ReadonlyArray<NoteListEntry>>
): AgentAccessFolderRow[] {
    return folders.map((folder) => ({
        folderId: folder.id,
        name: folder.name,
        access: getFolderAccess(grants, folder.id),
        notes: (notesByFolder[folder.id] ?? []).map((note) => ({
            noteId: note.docId,
            title: note.title,
            access: resolveAccess(grants, {
                noteId: note.docId,
                folderId: folder.id,
                excludeFromAI: note.metadata.excludeFromAI,
            }),
            override: grants.notes[note.docId] ?? null,
            locked: note.metadata.excludeFromAI === true,
        })),
    }));
}

/**
 * Agent-access grants for the current identity: load from JOURNAL_DRIVE, and mutate
 * folder/note grants with an optimistic cache update that rolls back on failure.
 */
export function useAgentGrants() {
    const client = useDotYouClientContext();
    const queryClient = useQueryClient();

    const { data, isLoading } = useQuery<AgentGrantsQueryData>({
        queryKey: AGENT_GRANTS_QUERY_KEY,
        queryFn: () => new AgentGrantsDriveProvider(client).load(),
    });

    const grants = data?.grants ?? EMPTY_GRANTS;

    const mutation = useMutation<
        { versionTag: string; fileId: string },
        Error,
        AgentAccessMutation,
        { previous: AgentGrantsQueryData | undefined }
    >({
        mutationFn: async (input) => {
            const cached = queryClient.getQueryData<AgentGrantsQueryData>(AGENT_GRANTS_QUERY_KEY);
            const next = nextGrantsFor(cached?.grants ?? EMPTY_GRANTS, input);
            return new AgentGrantsDriveProvider(client).save(next, cached?.versionTag, cached?.fileId);
        },
        onMutate: (input) => {
            const previous = queryClient.getQueryData<AgentGrantsQueryData>(AGENT_GRANTS_QUERY_KEY);
            const next = nextGrantsFor(previous?.grants ?? EMPTY_GRANTS, input);
            queryClient.setQueryData<AgentGrantsQueryData>(AGENT_GRANTS_QUERY_KEY, {
                grants: next,
                versionTag: previous?.versionTag,
                fileId: previous?.fileId,
            });
            return { previous };
        },
        onSuccess: (result) => {
            queryClient.setQueryData<AgentGrantsQueryData>(AGENT_GRANTS_QUERY_KEY, (current) =>
                current ? { ...current, versionTag: result.versionTag, fileId: result.fileId } : current
            );
        },
        onError: (error, _input, context) => {
            queryClient.setQueryData(AGENT_GRANTS_QUERY_KEY, context?.previous);
            if (error.message === 'AGENT_GRANTS_CONFLICT') {
                queryClient.invalidateQueries({ queryKey: AGENT_GRANTS_QUERY_KEY });
            }
            toast.error("Couldn't save agent access. Try again.");
        },
    });

    return {
        grants,
        isLoading,
        folderAccess: (folderId: string) => getFolderAccess(grants, folderId),
        noteOverride: (noteId: string): AgentAccess | null => grants.notes[noteId] ?? null,
        setFolder: (folderId: string, access: AgentAccess) =>
            mutation.mutate({ type: 'folder', folderId, access }),
        setNote: (noteId: string, access: AgentAccess | null) =>
            mutation.mutate({ type: 'note', noteId, access }),
        isSaving: mutation.isPending,
    };
}
