import type { DocumentMetadata } from '@/types';
import type { ShareTargets } from '@/hooks/useNoteCollaboration';
import { isOdinId, normalizeOdinId } from '@/lib/homebase/shareTargets';

/** A role on a shared note (#682). Viewers read it, editors also change it. */
export type ShareRole = 'viewer' | 'editor';

/** One row of "People with access": a circle or a named person, with their role. */
export interface AccessEntry {
    kind: 'circle' | 'person';
    /** The circle's id, or the person's identity. */
    id: string;
    role: ShareRole;
}

/** A circle as the share dialog lists it. `memberCount` is undefined while it loads. */
export interface ShareCircle {
    id: string;
    name: string;
    memberCount?: number;
    disabled?: boolean;
}

/** A search result in the share dialog: a circle or a connection, and why it can't be added. */
export interface ShareCandidate {
    kind: 'circle' | 'person';
    id: string;
    label: string;
    memberCount?: number;
    disabledReason?: string;
}

/**
 * Person editors need odin-core#2002 (#736). Until then a person is a viewer only, and the
 * dialog shows Editor disabled for them.
 */
export const PERSON_EDITORS_SUPPORTED = false;

export const NOT_A_CONNECTION = "Only people you're connected with can be added.";

/** The role a new row gets unless the owner picks one: Viewer for people, Editor for circles. */
export const defaultRole = (kind: AccessEntry['kind']): ShareRole => (kind === 'circle' ? 'editor' : 'viewer');

/** Who a note's metadata says it is shared with, circles first. */
export function accessFromMetadata(
    metadata: Pick<DocumentMetadata, 'isCollaborative' | 'circleIds' | 'viewerCircleIds' | 'odinIds'> | undefined,
): AccessEntry[] {
    if (!metadata?.isCollaborative) return [];
    return [
        ...(metadata.circleIds ?? []).map((id): AccessEntry => ({ kind: 'circle', id, role: 'editor' })),
        ...(metadata.viewerCircleIds ?? []).map((id): AccessEntry => ({ kind: 'circle', id, role: 'viewer' })),
        ...(metadata.odinIds ?? []).map((id): AccessEntry => ({ kind: 'person', id, role: 'viewer' })),
    ];
}

/** The full set to save through the share hook. */
export function targetsFromAccess(entries: AccessEntry[], circleName: (id: string) => string): ShareTargets {
    const circles = (role: ShareRole) => entries
        .filter((e) => e.kind === 'circle' && e.role === role)
        .map((e) => ({ circleId: e.id, name: circleName(e.id) }));
    return {
        circles: circles('editor'),
        viewerCircles: circles('viewer'),
        odinIds: entries.filter((e) => e.kind === 'person').map((e) => e.id),
    };
}

/** Whether two sets name the same circles and people with the same roles, in any order. */
export function sameAccess(a: AccessEntry[], b: AccessEntry[]): boolean {
    const key = (e: AccessEntry) => `${e.kind}:${e.id}:${e.role}`;
    const keys = new Set(a.map(key));
    return a.length === b.length && b.every((e) => keys.has(key(e)));
}

/**
 * The circles and connections matching `query` that aren't on the note yet: circles first,
 * then people, each alphabetical. A circle with no members is listed but can't be added,
 * and people can't be added while `peopleUnavailable` says why.
 */
export function searchCandidates({
    query,
    circles,
    connections,
    entries,
    owner,
    peopleUnavailable,
}: {
    query: string;
    circles: ShareCircle[];
    connections: string[];
    entries: AccessEntry[];
    owner: string;
    peopleUnavailable?: string;
}): ShareCandidate[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(entries.map((e) => `${e.kind}:${e.id}`));
    const byLabel = (a: ShareCandidate, b: ShareCandidate) => a.label.localeCompare(b.label);
    const circleRows = circles
        .filter((c) => !taken.has(`circle:${c.id}`) && c.name.toLowerCase().includes(q))
        .map((c): ShareCandidate => ({
            kind: 'circle',
            id: c.id,
            label: c.name,
            memberCount: c.memberCount,
            disabledReason: c.disabled ? 'Circle is disabled' : c.memberCount === 0 ? 'No members' : undefined,
        }))
        .sort(byLabel);
    const personRows = [...new Set(connections.map((c) => c.toLowerCase()))]
        .filter((odinId) => odinId !== owner && !taken.has(`person:${odinId}`) && odinId.includes(normalizeOdinId(q)))
        .map((odinId): ShareCandidate => ({ kind: 'person', id: odinId, label: odinId, disabledReason: peopleUnavailable }))
        .sort(byLabel);
    return [...circleRows, ...personRows];
}

/**
 * Why a typed identity can't be added when nothing matched it: it is the owner, already
 * has access, or is not a connection. Null when the text isn't an identity, or something matched.
 */
export function refusalFor(query: string, candidates: ShareCandidate[], owner: string, entries: AccessEntry[]): string | null {
    const odinId = normalizeOdinId(query);
    if (candidates.length > 0 || !isOdinId(odinId)) return null;
    if (odinId === owner) return "You can't share a note with yourself";
    if (entries.some((e) => e.kind === 'person' && e.id === odinId)) return `${odinId} already has access`;
    return NOT_A_CONNECTION;
}
