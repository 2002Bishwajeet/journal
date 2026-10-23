/**
 * The editor of the note the user is looking at (#700), for the in-app agent's editor tools.
 * The panel lives outside EditorContext and desktop keeps several note tabs mounted, so only
 * the active tab's editor registers here and clears it when it goes inactive or unmounts.
 */
import type { Editor } from '@tiptap/react';

export interface ActiveEditor {
    docId: string;
    editor: Editor;
    /** False for another person's read-only note and for a trashed one. */
    editable: boolean;
    excludeFromAI: boolean;
}

export interface ActiveEditorStore {
    get(): ActiveEditor | null;
    subscribe(listener: () => void): () => void;
}

let current: ActiveEditor | null = null;
const listeners = new Set<() => void>();

/** Registers `entry` as the active editor; the returned function clears it if it is still the active one. */
export function registerActiveEditor(entry: ActiveEditor): () => void {
    current = entry;
    listeners.forEach((l) => l());
    return () => {
        if (current !== entry) return;
        current = null;
        listeners.forEach((l) => l());
    };
}

export const activeEditor: ActiveEditorStore = {
    get: () => current,
    subscribe(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};
