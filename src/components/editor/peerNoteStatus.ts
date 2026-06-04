import type { PeerNoteContentStatus } from '@/hooks/usePeerNoteContent';

export const PEER_NOTE_MESSAGES: Partial<Record<PeerNoteContentStatus, string>> = {
    offline: "Can't reach the author to load this shared note. They may be offline.",
    forbidden: 'You no longer have access to this note.',
    notfound: 'This note no longer exists.',
    error: 'Something went wrong loading this shared note.',
};

const READY_STATUSES: PeerNoteContentStatus[] = ['local', 'fetched', 'empty'];

/** A failure status that should replace the editor with a message + retry. */
export function isPeerContentFailure(status: PeerNoteContentStatus): boolean {
    return status in PEER_NOTE_MESSAGES;
}

/** Content is present (or legitimately empty) — render the editor. */
export function isPeerContentReady(status: PeerNoteContentStatus): boolean {
    return READY_STATUSES.includes(status);
}
