// @vitest-environment happy-dom
/**
 * Undo/redo is provided by y-prosemirror's UndoManager (StarterKit history is
 * disabled because Yjs owns history). These tests pin two invariants:
 *   1. undo/redo actually revert/replay a local edit with the real extensions;
 *   2. recreating the editor on the same Yjs fragment WIPES undo history — which
 *      is why EditorProvider must keep a single stable editor per note instead of
 *      recreating it when AI-readiness / settings change.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension, undo, redo } from '@/components/editor/plugins/collaboration';

function makeEditor(fragment: Y.XmlFragment) {
  const element = document.createElement('div');
  return new Editor({ element, extensions: [...createBaseExtensions(), createCollaborationExtension(fragment)] });
}

describe('y-prosemirror undo/redo', () => {
  let ydoc: Y.Doc;
  let fragment: Y.XmlFragment;
  let editor: Editor;

  beforeEach(() => {
    ydoc = new Y.Doc();
    fragment = ydoc.getXmlFragment('prosemirror');
    editor = makeEditor(fragment);
  });

  it('undo reverts and redo replays a local text insertion', async () => {
    editor.commands.insertContent('hello world');
    // The UndoManager batches edits within ~500ms; pause so the insert is its
    // own undo step (mirrors a real pause between edits).
    await new Promise((r) => setTimeout(r, 600));

    expect(undo(editor.state)).toBe(true);
    expect(editor.getText()).toBe('');
    expect(redo(editor.state)).toBe(true);
    expect(editor.getText()).toBe('hello world');
  });

  it('undo works immediately after typing (no capture pause)', () => {
    editor.commands.insertContent('abc');
    expect(undo(editor.state)).toBe(true);
    expect(editor.getText()).toBe('');
  });

  it('recreating the editor on the same fragment loses undo history', () => {
    editor.commands.insertContent('typed before recreation');
    editor.destroy();

    // A second editor bound to the SAME fragment: content survives (it lives in
    // Yjs) but the UndoManager is brand new, so the prior edit can't be undone.
    const editor2 = makeEditor(fragment);
    expect(editor2.getText()).toBe('typed before recreation');
    expect(undo(editor2.state)).toBe(false);
    expect(editor2.getText()).toBe('typed before recreation');
    editor2.destroy();
  });
});
