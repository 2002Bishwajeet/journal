// @vitest-environment happy-dom
/**
 * Toggle and callout blocks (#159): inserted from the slash menu, undoable
 * through y-prosemirror's UndoManager, persisted in Yjs, and exited with
 * Enter-on-empty like a blockquote.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension, undo, redo } from '@/components/editor/plugins/collaboration';
import { slashCommandItems } from '@/components/editor/plugins/SlashCommands/slashCommandItems';

function makeEditor(fragment: Y.XmlFragment) {
  const element = document.createElement('div');
  return new Editor({ element, extensions: [...createBaseExtensions(), createCollaborationExtension(fragment)] });
}

/** Types `/<query>` into the empty doc and runs the slash item over it. */
function runSlash(editor: Editor, title: string) {
  const item = slashCommandItems.find((i) => i.title === title);
  if (!item) throw new Error(`no slash item ${title}`);
  const query = '/' + title.toLowerCase();
  editor.commands.insertContent(query);
  item.command({ editor, range: { from: 1, to: 1 + query.length } });
}

const topLevelTypes = (editor: Editor) => (editor.getJSON().content ?? []).map((n) => n.type);

describe.each([
  ['Toggle', 'toggle'],
  ['Callout', 'callout'],
])('%s block', (title, type) => {
  let ydoc: Y.Doc;
  let editor: Editor;

  beforeEach(() => {
    ydoc = new Y.Doc();
    editor = makeEditor(ydoc.getXmlFragment('prosemirror'));
  });

  afterEach(() => editor.destroy());

  it('is inserted by its slash command with an empty paragraph inside', () => {
    runSlash(editor, title);

    const node = editor.getJSON().content?.find((n) => n.type === type);
    expect(node).toBeDefined();
    expect(node!.content).toHaveLength(1);
    expect(node!.content![0]).toMatchObject({ type: 'paragraph' });
    expect(node!.content![0]).not.toHaveProperty('content');
    expect(editor.getText()).not.toContain('/');
    // The cursor lands inside the new block.
    expect(editor.state.selection.$from.node(1).type.name).toBe(type);
  });

  it('undo removes the inserted block and redo restores it', async () => {
    editor.commands.insertContent('before');
    // Separate undo step from the insertion below (UndoManager batches ~500ms).
    await new Promise((r) => setTimeout(r, 600));
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.splitBlock();
    runSlash(editor, title);
    await new Promise((r) => setTimeout(r, 600));
    expect(topLevelTypes(editor)).toContain(type);

    // The split, typed `/query` and slash insertion batch into one undo step.
    expect(undo(editor.state)).toBe(true);
    expect(topLevelTypes(editor)).not.toContain(type);
    expect(editor.getText()).toContain('before');

    expect(redo(editor.state)).toBe(true);
    expect(topLevelTypes(editor)).toContain(type);
  });

  it('round-trips its doc JSON through a Yjs update into a fresh editor', () => {
    runSlash(editor, title);
    editor.commands.insertContent('inner text');
    if (type === 'toggle') editor.commands.updateAttributes('toggle', { summary: 'My <title>' });
    else editor.commands.updateAttributes('callout', { variant: 'warning' });

    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
    const fresh = makeEditor(copy.getXmlFragment('prosemirror'));

    expect(fresh.getJSON()).toEqual(editor.getJSON());
    const node = fresh.getJSON().content?.find((n) => n.type === type);
    expect(node?.attrs).toEqual(type === 'toggle' ? { summary: 'My <title>' } : { variant: 'warning' });
    fresh.destroy();
  });

  it('Enter twice at the end of its last paragraph moves the cursor after it', () => {
    runSlash(editor, title);
    editor.commands.insertContent('inner');

    editor.commands.keyboardShortcut('Enter');
    editor.commands.keyboardShortcut('Enter');

    const { $from } = editor.state.selection;
    expect($from.depth).toBe(1);
    expect($from.parent.type.name).toBe('paragraph');
    const index = $from.index(0);
    expect(editor.state.doc.child(index - 1).type.name).toBe(type);
    expect(editor.state.doc.child(index - 1).textContent).toBe('inner');
  });
});
