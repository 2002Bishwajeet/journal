/**
 * Y.js Collaboration Extension
 * 
 * Integrates Y.js with TipTap for real-time collaboration and offline sync.
 * Provides Y.js-based undo/redo that works with collaborative editing.
 */

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { ySyncPlugin, ySyncPluginKey, yUndoPlugin, undo, redo, type ProsemirrorBinding } from 'y-prosemirror';
import type { XmlFragment } from 'yjs';

/**
 * After an undo, redo or remote change y-prosemirror restores the selection, a node
 * selection with NodeSelection.create, which throws when the node has gone from that
 * spot (undoing an image dragged to the end of a line, #603) and leaves the change
 * half applied. Kept as a text selection over the same range, it always restores.
 */
function nodeSelectionsAsText(): Plugin {
    return new Plugin({
        view: (view) => {
            const binding: ProsemirrorBinding | undefined = ySyncPluginKey.getState(view.state)?.binding;
            if (!binding) return {};
            // Runs after the binding's own listener, which saves the selection
            const toText = () => {
                const saved = binding.beforeTransactionSelection;
                if (saved?.type === 'node') binding.beforeTransactionSelection = { ...saved, type: 'text' };
            };
            binding.doc.on('beforeAllTransactions', toText);
            return { destroy: () => binding.doc.off('beforeAllTransactions', toText) };
        },
    });
}

/**
 * Creates a collaboration extension for the given Y.js XML fragment.
 * This extension:
 * - Syncs editor content with Y.js document
 * - Provides Y.js-aware undo/redo (tracks remote changes separately)
 * 
 * Note: y-prosemirror's yUndoPlugin creates and manages its own UndoManager
 * with proper configuration including:
 * - trackedOrigins: tracks only user edits via ySyncPluginKey
 * - deleteFilter: protects paragraph nodes from deletion
 * - captureTransaction: respects 'addToHistory' meta
 * 
 * @param yXmlFragment - The Y.js XML fragment to sync with
 */
export function createCollaborationExtension(yXmlFragment: XmlFragment) {
    return Extension.create({
        name: 'collaboration',

        addProseMirrorPlugins() {
            return [
                ySyncPlugin(yXmlFragment),
                // Let y-prosemirror create and manage the UndoManager internally
                yUndoPlugin(),
                nodeSelectionsAsText(),
            ];
        },

        addKeyboardShortcuts() {
            return {
                'Mod-z': () => {
                    undo(this.editor.state);
                    return true;
                },
                'Mod-y': () => {
                    redo(this.editor.state);
                    return true;
                },
                'Mod-Shift-z': () => {
                    redo(this.editor.state);
                    return true;
                },
            };
        },
    });
}

// Re-export Y.js undo/redo for use in toolbar
export { undo, redo };

