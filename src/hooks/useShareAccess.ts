import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchMembersOfCircle } from '@homebase-id/js-lib/network';
import { useDotYouClientContext } from '@/components/auth';
import { useCircles } from '@/hooks/circles/useCircles';
import { useNotes } from '@/hooks/useNotes';
import { useNoteCollaboration, type ShareResult } from '@/hooks/useNoteCollaboration';
import { usePersonSharingSupported } from '@/hooks/usePersonSharingSupported';
import { getAllConnectionIds } from '@/hooks/usePeerPushSubscriptions';
import {
    accessFromMetadata,
    defaultRole,
    refusalFor,
    sameAccess,
    searchCandidates,
    targetsFromAccess,
    type AccessEntry,
    type ShareCandidate,
    type ShareCircle,
    type ShareRole,
} from '@/lib/share/shareAccess';

export const PEOPLE_UNSUPPORTED = 'Your Homebase server is too old to share a note with a person. Update it to use this.';

/**
 * The "People with access" part of the Share dialog (#682): who the note is shared with,
 * the owner's circles and connections to add from, and the changes not saved yet. Save
 * hands the full new set to {@link useNoteCollaboration}; an empty set stops sharing.
 */
export function useShareAccess(noteId: string, enabled: boolean) {
    const dotYouClient = useDotYouClientContext();
    const owner = dotYouClient.getHostIdentity();
    const { share, revoke } = useNoteCollaboration();
    const note = useNotes().get.data?.find((n) => n.docId === noteId);
    const personSharing = usePersonSharingSupported();

    const { fetch: circlesFetch } = useCircles(true);
    const circleDefs = enabled ? (circlesFetch.data ?? []).filter((c): c is typeof c & { id: string } => !!c.id) : [];
    // The same query key as useCircle, so the counts are shared with other circle lists
    const memberQueries = useQueries({
        queries: circleDefs.map((c) => ({
            queryKey: ['circleMembers', c.id],
            queryFn: () => fetchMembersOfCircle(dotYouClient, c.id),
            refetchOnWindowFocus: false,
        })),
    });
    const circles: ShareCircle[] = circleDefs.map((c, i) => ({
        id: c.id,
        name: c.name,
        memberCount: memberQueries[i]?.data?.length,
        disabled: c.disabled,
    }));
    const connections = useQuery({
        queryKey: ['connections', owner],
        queryFn: async () => [...(await getAllConnectionIds(dotYouClient))],
        staleTime: 5 * 60 * 1000,
        retry: false,
        enabled,
    });

    const saved = accessFromMetadata(note?.metadata);
    const [draft, setDraft] = useState<AccessEntry[] | null>(null);
    const entries = draft ?? saved;
    const isDirty = draft !== null && !sameAccess(draft, saved);
    const [isSaving, setIsSaving] = useState(false);

    const [query, setQuery] = useState('');
    // Null: the first result that can be added, so Enter adds it
    const [pickedIndex, setActiveIndex] = useState<number | null>(null);
    // Undefined: the default for the highlighted result's kind
    const [pickedRole, setPickedRole] = useState<ShareRole>();
    const candidates = searchCandidates({
        query,
        circles,
        connections: connections.data ?? [],
        entries,
        owner,
        peopleUnavailable: personSharing === false ? PEOPLE_UNSUPPORTED : undefined,
    });
    const activeIndex = pickedIndex !== null && pickedIndex < candidates.length
        ? pickedIndex
        : Math.max(candidates.findIndex((c) => !c.disabledReason), 0);
    const active: ShareCandidate | undefined = candidates[activeIndex];
    const roleFor = (kind: AccessEntry['kind']): ShareRole =>
        kind === 'person' ? 'viewer' : (pickedRole ?? defaultRole(kind));

    const circleName = (id: string) => circles.find((c) => c.id === id)?.name ?? 'Unknown circle';

    const add = (candidate: ShareCandidate | undefined = active) => {
        if (!candidate || candidate.disabledReason) return;
        setDraft([...entries, { kind: candidate.kind, id: candidate.id, role: roleFor(candidate.kind) }]);
        setQuery('');
        setActiveIndex(null);
    };

    const setRole = (entry: AccessEntry, role: ShareRole) =>
        setDraft(entries.map((e) => (e.kind === entry.kind && e.id === entry.id ? { ...e, role } : e)));

    const remove = (entry: AccessEntry) =>
        setDraft(entries.filter((e) => !(e.kind === entry.kind && e.id === entry.id)));

    /** Saves the changes, if any. An empty set stops sharing. */
    const save = async (): Promise<ShareResult> => {
        if (!isDirty) return { shared: true };
        setIsSaving(true);
        try {
            const result = entries.length === 0
                ? { shared: await revoke(note ?? null) }
                : await share(noteId, targetsFromAccess(entries, circleName));
            if (result.shared) setDraft(null);
            return result;
        } finally {
            setIsSaving(false);
        }
    };

    /** Stops sharing with everyone. */
    const stopSharing = async (): Promise<boolean> => {
        setIsSaving(true);
        try {
            const stopped = await revoke(note ?? null);
            if (stopped) setDraft(null);
            return stopped;
        } finally {
            setIsSaving(false);
        }
    };

    return {
        note,
        owner,
        entries,
        isShared: saved.length > 0,
        isDirty,
        isSaving,
        isLoading: circlesFetch.isLoading || connections.isLoading,
        circles,
        circleName,
        query,
        setQuery: (value: string) => {
            setQuery(value);
            setActiveIndex(null);
        },
        candidates,
        active,
        setActiveIndex,
        refusal: refusalFor(query, candidates, owner, entries),
        role: active ? roleFor(active.kind) : (pickedRole ?? 'viewer'),
        setPickedRole,
        add,
        setRole,
        remove,
        save,
        stopSharing,
    };
}

export type ShareAccess = ReturnType<typeof useShareAccess>;
