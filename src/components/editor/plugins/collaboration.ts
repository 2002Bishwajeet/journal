/**
 * Y.js Collaboration Extension
 * 
 * Integrates Y.js with TipTap for real-time collaboration and offline sync.
 * Provides Y.js-based undo/redo that works with collaborative editing.
 */

import { Extension } from '@tiptap/core';
import { ySyncPlugin, yUndoPlugin, undo, redo } from 'y-prosemirror';
import { UndoManager } from 'yjs';
import type { XmlFragment } from 'yjs';

// Store the UndoManager so it can be accessed for undo/redo operations
let currentUndoManager: UndoManager | null = null;

/**
 * Creates a collaboration extension for the given Y.js XML fragment.
 * This extension:
 * - Syncs editor content with Y.js document
 * - Provides Y.js-aware undo/redo (tracks remote changes separately)
 * 
 * @param yXmlFragment - The Y.js XML fragment to sync with
 */
export function createCollaborationExtension(yXmlFragment: XmlFragment) {
    // Create UndoManager that tracks changes to the XML fragment
    // This is required for undo/redo to work with programmatic changes (like AI)
    const undoManager = new UndoManager(yXmlFragment, {
        // Track all changes including programmatic ones
        trackedOrigins: new Set([null]),
    });

    currentUndoManager = undoManager;

    return Extension.create({
        name: 'collaboration',

        addProseMirrorPlugins() {
            return [
                ySyncPlugin(yXmlFragment),
                yUndoPlugin({ undoManager }),
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

        onDestroy() {
            // Clean up UndoManager when editor is destroyed
            if (currentUndoManager === undoManager) {
                undoManager.destroy();
                currentUndoManager = null;
            }
        },
    });
}

// Re-export Y.js undo/redo for use in toolbar
export { undo, redo };

