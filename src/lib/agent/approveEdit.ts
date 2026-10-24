/**
 * Asks the user to accept or reject an edit the in-app agent proposes for the open note (#701).
 * The edit shows in the note as a preview (AgentEditPreview) and nothing changes until Accept,
 * which builds the edit again against the note as it is then and applies it as one undo step.
 * One edit is shown at a time; later ones wait in line. Closing the note or switching tabs
 * rejects them. This module is headless: the note's preview is in `AgentEditPreview`.
 */
import type { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { dispatchUndoStep } from '@/components/editor/nodes/galleryDrag';
import { activeEditor } from './activeEditor';

export type EditOutcome = 'accepted' | 'rejected' | { notApplied: string };

export interface BuiltEdit {
    tr: Transaction;
    summary: string;
}

export interface EditProposal {
    /** The edit built against the open note's state when the model proposed it. */
    built: BuiltEdit;
    /** Builds the edit again against the note's state now; throws when it no longer applies. */
    rebuild(): Promise<BuiltEdit>;
}

export interface PendingEdit extends BuiltEdit {
    id: number;
    editor: Editor;
    rebuild: EditProposal['rebuild'];
    resolve(outcome: EditOutcome): void;
}

export const NOT_APPLIED_MESSAGE = "The note changed, so this edit wasn't applied";

let queue: PendingEdit[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** The edit waiting for the user's answer in `editor`. */
export const pendingEdits = {
    current: (editor: Editor): PendingEdit | null => (queue[0]?.editor === editor ? queue[0] : null),
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};

function settle(item: PendingEdit, outcome: EditOutcome) {
    if (!queue.includes(item)) return;
    queue = queue.filter((other) => other !== item);
    item.resolve(outcome);
    notify();
}

/** Asks for the user's answer to `proposal.edit`; a proposal with no edit, or with no note open, is rejected. */
export function approveEdit(proposal: { edit?: EditProposal }, signal?: AbortSignal): Promise<EditOutcome> {
    const open = activeEditor.get();
    if (!proposal.edit || !open || signal?.aborted) return Promise.resolve('rejected');
    const { built, rebuild } = proposal.edit;
    return new Promise((resolve) => {
        const item: PendingEdit = { ...built, id: nextId++, editor: open.editor, rebuild, resolve };
        queue.push(item);
        signal?.addEventListener('abort', () => settle(item, 'rejected'), { once: true });
        notify();
    });
}

export function rejectEdit(item: PendingEdit): void {
    settle(item, 'rejected');
}

/**
 * Builds the edit again against the note as it is now and applies it as one undo step.
 * Returns the outcome, so the caller can tell the user when it was not applied.
 */
export async function acceptEdit(item: PendingEdit): Promise<EditOutcome> {
    if (!queue.includes(item)) return 'rejected';
    let outcome: EditOutcome;
    try {
        const { tr } = await item.rebuild();
        const { view } = item.editor;
        if (!queue.includes(item)) return 'rejected';
        if (tr.before !== view.state.doc) throw new Error('The note changed while the edit was built.');
        dispatchUndoStep(view, tr);
        outcome = 'accepted';
    } catch (error) {
        outcome = { notApplied: error instanceof Error ? error.message : String(error) };
    }
    settle(item, outcome);
    return outcome;
}

// Closing the note, switching tabs, or making the note read-only or kept from AI rejects its edits.
// The check waits a tick: re-registering the same editor clears and sets it in one commit.
activeEditor.subscribe(() =>
    queueMicrotask(() => {
        const open = activeEditor.get();
        for (const item of queue) {
            if (open?.editor !== item.editor || !open.editable || open.excludeFromAI) settle(item, 'rejected');
        }
    })
);
