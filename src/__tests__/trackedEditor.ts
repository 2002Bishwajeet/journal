/**
 * Editors created through createTrackedEditor are destroyed after every test.
 * A leaked ProseMirror EditorView keeps a DOMObserver timer that can fire after
 * the test file's DOM environment is torn down ("document is not defined").
 * Importing this module registers the afterEach in the importing test file.
 */
import { afterEach } from 'vitest';
import { Editor, type EditorOptions } from '@tiptap/core';

const created: Editor[] = [];

export function createTrackedEditor(options: Partial<EditorOptions>): Editor {
    const editor = new Editor(options);
    created.push(editor);
    return editor;
}

afterEach(() => {
    for (const editor of created.splice(0)) {
        if (!editor.isDestroyed) editor.destroy();
    }
});
