/**
 * Y.js Collaboration Extension
 * 
 * Integrates Y.js with TipTap for real-time collaboration and offline sync.
 * Provides Y.js-based undo/redo that works with collaborative editing.
 */

import { Extension } from '@tiptap/core';
import { ySyncPlugin, yUndoPlugin, undo, redo } from 'y-prosemirror';
import type { XmlFragment } from 'yjs';

/**
 * Creates a collaboration extension for the given Y.js XML fragment.
 * This extension:
 * - Syncs editor content with Y.js document
 * - Provides Y.js-aware undo/redo (tracks remote changes separately)
 * 
 * @param yXmlFragment - The Y.js XML fragment to sync with
 */
export function createCollaborationExtension(yXmlFragment: XmlFragment) {
    return Extension.create({
        name: 'collaboration',

        addProseMirrorPlugins() {
            return [
                ySyncPlugin(yXmlFragment),
                yUndoPlugin(),
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
