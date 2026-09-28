import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDotYouClientContext } from '@/components/auth';
import { AgentGrantsDriveProvider } from '@/lib/homebase/AgentGrantsDriveProvider';
import {
    type AgentAccess,
    type AgentGrants,
    EMPTY_GRANTS,
    resolveAccess,
    setFolderAccess,
    setNoteAccess,
} from '@/lib/agent/grants';
import type { NoteListEntry } from '@/types';

export const AGENT_GRANTS_QUERY_KEY = ['agent-grants'] as const;

interface AgentGrantsQueryData {
    grants: AgentGrants;
    versionTag?: string;
    fileId?: string;
}

export interface AgentAccessNoteRow {
    noteId: string;
    title: string;
    access: AgentAccess;
    override: AgentAccess | null;
    locked: boolean;
}

/**
 * Pure view-model for one folder's notes on the Agent access settings screen: each
 * note's effective access, its override, and whether it's locked by excludeFromAI.
 * Exported for tests (src/__tests__/agentGrantsSettings.test.ts).
 */
export function buildNoteRows(
    grants: AgentGrants,
    folderId: string,
    notes: ReadonlyArray<NoteListEntry>
): AgentAccessNoteRow[] {
    return notes.map((note) => ({
        noteId: note.docId,
        title: note.title,
        access: resolveAccess(grants, { noteId: note.docId, folderId, excludeFromAI: note.metadata.excludeFromAI }),
        override: grants.notes[note.docId] ?? null,
        locked: note.metadata.excludeFromAI === true,
    }));
}

/**
 * Agent-access grants for the current identity: load from JOURNAL_DRIVE, and mutate
 * folder/note grants with an optimistic cache update that rolls back on failure.
 */
export function useAgentGrants() {
    const client = useDotYouClientContext();
    const queryClient = useQueryClient();

    const { data } = useQuery<AgentGrantsQueryData>({
        queryKey: AGENT_GRANTS_QUERY_KEY,
        queryFn: () => new AgentGrantsDriveProvider(client).load(),
    });

    const grants = data?.grants ?? EMPTY_GRANTS;

    const mutation = useMutation<
        { versionTag: string; fileId: string },
        Error,
        AgentGrants,
        { previous: AgentGrantsQueryData | undefined }
    >({
        mutationFn: (next) => {
            const cached = queryClient.getQueryData<AgentGrantsQueryData>(AGENT_GRANTS_QUERY_KEY);
            return new AgentGrantsDriveProvider(client).save(next, cached?.versionTag, cached?.fileId);
        },
        onMutate: (next) => {
            const previous = queryClient.getQueryData<AgentGrantsQueryData>(AGENT_GRANTS_QUERY_KEY);
            queryClient.setQueryData<AgentGrantsQueryData>(AGENT_GRANTS_QUERY_KEY, { ...previous, grants: next });
            return { previous };
        },
        onSuccess: (result) => {
            queryClient.setQueryData<AgentGrantsQueryData>(AGENT_GRANTS_QUERY_KEY, (current) =>
                current ? { ...current, versionTag: result.versionTag, fileId: result.fileId } : current
            );
        },
        onError: (_error, _next, context) => {
            if (context?.previous) queryClient.setQueryData(AGENT_GRANTS_QUERY_KEY, context.previous);
            // Refetch so the screen ends up showing what the drive actually holds.
            queryClient.invalidateQueries({ queryKey: AGENT_GRANTS_QUERY_KEY });
            toast.error("Couldn't save agent access. Try again.");
        },
    });

    return {
        grants,
        // Until the grants file loads, `grants` is EMPTY_GRANTS with no fileId: saving then
        // would drop every existing grant and collide with the file's fixed uniqueId.
        isLoaded: data !== undefined,
        setFolder: (folderId: string, access: AgentAccess) => mutation.mutate(setFolderAccess(grants, folderId, access)),
        setNote: (noteId: string, access: AgentAccess | null) => mutation.mutate(setNoteAccess(grants, noteId, access)),
    };
}
