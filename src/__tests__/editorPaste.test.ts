// @vitest-environment happy-dom
/**
 * Regression: multi-line content pasted from the web (YouTube comments, Notion,
 * chat apps) arrives as ONE block whose lines are joined by <br> hard-breaks.
 * Block formatting (Heading/List) then hit the whole block — selecting one line
 * and pressing "Heading 2" converted every line, and toggling a list collapsed
 * everything into a single un-exitable item. `splitHardBreaksSlice` (wired as a
 * transformPasted plugin) splits those hard-breaks into real paragraphs on paste.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { EditorView } from '@tiptap/pm/view';
import type { Slice } from '@tiptap/pm/model';
import * as pmView from '@tiptap/pm/view';
import { splitHardBreaksSlice } from '@/components/editor/plugins/extensions';

// __parseFromClipboard is exported at runtime but absent from the type defs.
const parseFromClipboard = (pmView as unknown as {
  __parseFromClipboard: (view: EditorView, text: string, html: string | null, plainText: boolean, $ctx: unknown) => Slice | null;
}).__parseFromClipboard;

function mkEditor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [StarterKit.configure({ codeBlock: false, undoRedo: false, link: false, underline: false })],
    content: '<p></p>',
  });
}

// Simulate a real paste: parse the clipboard exactly like ProseMirror, run our
// transform (what the transformPasted plugin does), then insert.
function paste(editor: Editor, html: string, text = '') {
  const view = editor.view;
  const raw = parseFromClipboard(view, text, html, false, view.state.selection.$from);
  if (!raw) return;
  const transformed = splitHardBreaksSlice(raw, view.state.schema);
  view.dispatch(view.state.tr.replaceSelection(transformed));
}

describe('splitHardBreaksSlice — paste of <br>-joined content', () => {
  let e: Editor;
  beforeEach(() => { e = mkEditor(); });

  it('splits bare <br> lines into separate paragraphs', () => {
    paste(e, 'Line A<br>Line B<br>Line C');
    expect(e.getHTML()).toBe('<p>Line A</p><p>Line B</p><p>Line C</p>');
  });

  it('lets Heading 2 apply to ONE line only (bug: used to convert every line)', () => {
    paste(e, 'Line A<br>Line B<br>Line C');
    e.chain().setTextSelection({ from: 1, to: 7 }).toggleHeading({ level: 2 }).run();
    expect(e.getHTML()).toBe('<h2>Line A</h2><p>Line B</p><p>Line C</p>');
  });

  it('lets a bullet list become separate, exitable items (bug: was one item)', () => {
    paste(e, '<div>One<br>Two<br>Three</div>');
    e.chain().selectAll().toggleBulletList().run();
    expect(e.getHTML()).toBe(
      '<ul><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ul><p></p>',
    );
  });

  it('handles the real YouTube recipe comment (blank lines preserved)', () => {
    paste(e, '🍰 Ingredients:<br><br>Plain Flour 200g<br>Sugar 150g<br>Eggs 3');
    const types = e.getJSON().content?.map((n) => n.type);
    expect(types).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(e.getHTML()).toBe(
      '<p>🍰 Ingredients:</p><p></p><p>Plain Flour 200g</p><p>Sugar 150g</p><p>Eggs 3</p>',
    );
  });

  it('merges first/last line into the surrounding paragraph when pasted mid-line', () => {
    e.commands.setContent('<p>HelloWorld</p>');
    e.chain().setTextSelection(6).run(); // between "Hello" and "World"
    paste(e, 'AAA<br>BBB');
    expect(e.getHTML()).toBe('<p>HelloAAA</p><p>BBBWorld</p>');
  });

  it('leaves single-line paste (no hard-break) untouched', () => {
    paste(e, 'just one line', 'just one line');
    expect(e.getHTML()).toBe('<p>just one line</p>');
  });

  it('leaves plain-text paste (already separate paragraphs) untouched', () => {
    paste(e, '', 'First.\n\nSecond.\n\nThird.');
    expect(e.getHTML()).toBe('<p>First.</p><p>Second.</p><p>Third.</p>');
  });
});

describe('SplitHardBreaksOnPaste — wired into the real editor extensions', () => {
  it('registers a transformPasted prop via createBaseExtensions', async () => {
    const { createBaseExtensions } = await import('@/components/editor/plugins/extensions');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({ element: el, extensions: createBaseExtensions(), content: '<p></p>' });
    expect(editor.view.someProp('transformPasted')).toBeTypeOf('function');
    editor.destroy();
  });
});
