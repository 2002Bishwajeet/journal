import { Extension } from '@tiptap/core';
import { EDITOR_ESCAPE_EVENT } from '@/lib/editorEscape';

/** Tells the app about an Escape pressed in the editor that no menu, suggestion or Find bar used (#1391). */
export const EditorEscape = Extension.create({
    name: 'editorEscape',
    // Below every extension that closes something on Escape (default priority is 100).
    priority: 1,

    addKeyboardShortcuts() {
        return {
            Escape: () => {
                window.dispatchEvent(new Event(EDITOR_ESCAPE_EVENT));
                return false;
            },
        };
    },
});
