/**
 * Asks the user to accept or reject a write the in-app agent proposes for a note that is not
 * the open one (#702): an append to another note, or a new note. Unlike an edit to the open
 * note (approveEdit), it has no preview in an editor; the assistant panel shows it as a card.
 * Nothing is written until Accept. One proposal is shown at a time; Stop rejects it.
 */
import type { EditOutcome } from './approveEdit';

/** The note a write touched, for the link on the card. */
export interface WrittenNote {
    id: string;
    title: string;
    folderId: string;
}

export interface WriteProposal {
    /** One line: "Append to 'Packing list'" or "Create note 'Ideas' in Main". */
    summary: string;
    /** The markdown the agent wants to add, shown as plain text. */
    markdown: string;
    /** Writes it, against the note as it is now. Throws when it no longer applies. */
    apply(): Promise<WrittenNote>;
    /** Set once `apply` has run. */
    applied?: WrittenNote;
}

export interface PendingWrite {
    id: number;
    write: WriteProposal;
    resolve(outcome: EditOutcome): void;
    /** Accept was clicked and the write is running, so a second click does nothing. */
    accepting?: boolean;
}

let queue: PendingWrite[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const pendingWrites = {
    current: (): PendingWrite | null => queue[0] ?? null,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};

function settle(item: PendingWrite, outcome: EditOutcome) {
    if (!queue.includes(item)) return;
    queue = queue.filter((other) => other !== item);
    item.resolve(outcome);
    notify();
}

export function approveWrite(write: WriteProposal, signal?: AbortSignal): Promise<EditOutcome> {
    if (signal?.aborted) return Promise.resolve('rejected');
    return new Promise((resolve) => {
        const item: PendingWrite = { id: nextId++, write, resolve };
        queue.push(item);
        signal?.addEventListener('abort', () => settle(item, 'rejected'), { once: true });
        notify();
    });
}

export function rejectWrite(item: PendingWrite): void {
    settle(item, 'rejected');
}

/** Writes it now; returns the outcome so the caller can tell the user when it was not applied. */
export async function acceptWrite(item: PendingWrite): Promise<EditOutcome> {
    if (!queue.includes(item) || item.accepting) return 'rejected';
    item.accepting = true;
    let outcome: EditOutcome;
    try {
        item.write.applied = await item.write.apply();
        outcome = 'accepted';
    } catch (error) {
        outcome = { notApplied: error instanceof Error ? error.message : String(error) };
    }
    settle(item, outcome);
    return outcome;
}
