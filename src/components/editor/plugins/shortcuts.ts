/**
 * Custom Keyboard Shortcuts Extension
 * 
 * Defines custom keyboard shortcuts that don't conflict with app-level shortcuts.
 * 
 * App shortcuts (handled by useKeyboardShortcuts hook):
 * - Cmd+K: Search
 * - Cmd+N: New Note
 * - Cmd+S: Save
 * 
 * Editor shortcuts defined here:
 * - Cmd+Shift+K: Add/Edit Link (alternative to Cmd+K which is taken by Search)
 */

import { Extension } from '@tiptap/core';

export interface CustomShortcutsOptions {
    onAddLink?: () => void;
}

/**
 * Custom shortcuts extension that avoids conflicts with app shortcuts.
 */
export const CustomShortcuts = Extension.create<CustomShortcutsOptions>({
    name: 'customShortcuts',

    addOptions() {
        return {
            onAddLink: undefined,
        };
    },

    addKeyboardShortcuts() {
        return {
            // Cmd+Shift+K for link (Cmd+K is used by app for search)
            'Mod-Shift-k': () => {
                if (this.options.onAddLink) {
                    this.options.onAddLink();
                    return true;
                }
                // Fallback: toggle link if no custom handler
                const { editor } = this;
                if (editor.isActive('link')) {
                    editor.chain().focus().unsetLink().run();
                } else {
                    // Can't set link without URL, so this is a no-op
                    // The toolbar popover should be used instead
                }
                return true;
            },

            // Arrow right at end of link exits the link mark
            'ArrowRight': () => {
                const { editor } = this;
                const { selection } = editor.state;
                const { $from } = selection;

                // Only handle if we're at the end of a link
                if (!editor.isActive('link')) return false;

                // Check if cursor is at the end of the current text node
                const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
                if (!isAtEnd) return false;

                // Remove the link mark for subsequent typing
                editor.chain().focus().unsetLink().run();
                return false; // Let default behavior move cursor
            },

            // Space at end of link exits the link and inserts space
            'Space': () => {
                const { editor } = this;

                if (!editor.isActive('link')) return false;

                const { selection } = editor.state;
                const { $from } = selection;

                // Check if cursor is at the end of the current text node
                const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
                if (!isAtEnd) return false;

                // Unset link, insert space without link mark
                editor.chain()
                    .focus()
                    .unsetLink()
                    .insertContent(' ')
                    .run();
                return true;
            },
        };
    },
});

/**
 * Keyboard Shortcuts Reference
 * 
 * This documents all keyboard shortcuts used in the editor.
 * 
 * === App-Level Shortcuts (useKeyboardShortcuts hook) ===
 * Cmd+K     - Open Search
 * Cmd+N     - New Note
 * Cmd+S     - Save Note
 * 
 * === StarterKit Shortcuts (built-in) ===
 * Cmd+B     - Bold
 * Cmd+I     - Italic
 * Cmd+Shift+X - Strikethrough
 * Cmd+E     - Inline Code
 * Cmd+Shift+7 - Ordered List
 * Cmd+Shift+8 - Bullet List
 * Cmd+Shift+9 - Task List (via TaskList extension)
 * 
 * === Y.js Collaboration Shortcuts ===
 * Cmd+Z     - Undo (Y.js aware)
 * Cmd+Y     - Redo (Y.js aware)
 * Cmd+Shift+Z - Redo (Y.js aware, alternative)
 * 
 * === Custom Shortcuts (this extension) ===
 * Cmd+Shift+K - Add/Edit Link
 */
