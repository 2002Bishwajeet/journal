// @vitest-environment happy-dom
/** An Escape the editor did not use reaches the app's Esc handler, even though ProseMirror prevents it (#1391). */
import { describe, it, expect, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { EditorEscape } from '@/components/editor/plugins/EditorEscapeExtension';
import { EDITOR_ESCAPE_EVENT } from '@/lib/editorEscape';

function pressEscape(editor: Editor) {
    const event = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, cancelable: true });
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
}

describe('EditorEscape', () => {
    it('announces an Escape pressed in the editor', () => {
        const editor = new Editor({ extensions: [Document, Paragraph, Text, EditorEscape] });
        const heard = vi.fn();
        window.addEventListener(EDITOR_ESCAPE_EVENT, heard);

        pressEscape(editor);
        expect(heard).toHaveBeenCalledTimes(1);

        window.removeEventListener(EDITOR_ESCAPE_EVENT, heard);
        editor.destroy();
    });

    it('stays quiet when an earlier extension used the Escape', () => {
        const Closer = EditorEscape.extend({ name: 'closer', priority: 100, addKeyboardShortcuts: () => ({ Escape: () => true }) });
        const editor = new Editor({ extensions: [Document, Paragraph, Text, EditorEscape, Closer] });
        const heard = vi.fn();
        window.addEventListener(EDITOR_ESCAPE_EVENT, heard);

        pressEscape(editor);
        expect(heard).not.toHaveBeenCalled();

        window.removeEventListener(EDITOR_ESCAPE_EVENT, heard);
        editor.destroy();
    });
});
