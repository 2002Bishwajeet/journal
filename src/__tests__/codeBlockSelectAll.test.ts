// @vitest-environment happy-dom
/**
 * Mod-a inside a code block selects only its code; a second Mod-a (or Mod-a
 * outside a code block) selects the whole note.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';

let editor: Editor;

function mkEditor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor = new Editor({
    element: el,
    extensions: createBaseExtensions(),
    content: '<p>Intro</p><pre><code class="language-html">&lt;div&gt;Hi&lt;/div&gt;</code></pre><p>Outro</p>',
  });
  return editor;
}

afterEach(() => editor?.destroy());

function pressModA() {
  const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', { key: 'a', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
}

function codeBlockRange() {
  let range = { from: -1, to: -1 };
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') range = { from: pos + 1, to: pos + node.nodeSize - 1 };
  });
  return range;
}

const isWholeDoc = () =>
  editor.state.selection instanceof AllSelection ||
  (editor.state.selection.from === 0 && editor.state.selection.to === editor.state.doc.content.size);

describe('Select All in a code block', () => {
  it('selects only the code, then the whole note on a second press', () => {
    mkEditor();
    const { from, to } = codeBlockRange();
    editor.commands.setTextSelection(from + 2);

    pressModA();
    expect(editor.state.selection.from).toBe(from);
    expect(editor.state.selection.to).toBe(to);
    expect(editor.state.doc.textBetween(from, to)).toBe('<div>Hi</div>');

    pressModA();
    expect(isWholeDoc()).toBe(true);
  });

  it('selects the whole note from a paragraph', () => {
    mkEditor();
    editor.commands.setTextSelection(2);
    pressModA();
    expect(isWholeDoc()).toBe(true);
  });
});
