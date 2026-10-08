// @vitest-environment happy-dom
/**
 * #518: in the editor, inserting, deleting and moving footnote references keeps
 * the footnotes section in step and the numbers right.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';

let editor: Editor;

function mkEditor(content = '<p>First second third</p>') {
  const el = document.createElement('div');
  document.body.appendChild(el);
  editor = new Editor({ element: el, extensions: createBaseExtensions(), content });
  return editor;
}

afterEach(() => editor?.destroy());

/** Position just after the first occurrence of `word`. */
function after(word: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(word)) found = pos + node.text!.indexOf(word) + word.length;
  });
  return found;
}

function insertAfter(word: string, note: string) {
  editor.chain().setTextSelection(after(word)).insertFootnote().run();
  editor.commands.insertContent(note);
}

/** Numbers shown on the references, in text order. */
const shownNumbers = () =>
  [...editor.view.dom.querySelectorAll('sup[data-type="footnote-reference"]')].map((el) => el.getAttribute('data-number'));
const notes = () => [...editor.view.dom.querySelectorAll('li[data-type="footnote"]')].map((el) => el.textContent?.replace('↩', ''));
const refPositions = () => {
  const out: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteReference') out.push(pos);
  });
  return out;
};

describe('footnotes in the editor', () => {
  it('inserts a reference, a note at the end, and puts the cursor in the note', () => {
    mkEditor();
    insertAfter('second', 'About second');
    expect(shownNumbers()).toEqual(['1']);
    expect(notes()).toEqual(['About second']);
    expect(editor.state.doc.lastChild?.type.name).toBe('footnotes');
  });

  it('numbers a reference inserted before another as 1 and renumbers the other', () => {
    mkEditor();
    insertAfter('third', 'About third');
    insertAfter('First', 'About first');
    expect(shownNumbers()).toEqual(['1', '2']);
    expect(notes()).toEqual(['About first', 'About third']);
  });

  it('drops the note and renumbers when a reference is deleted', () => {
    mkEditor();
    insertAfter('First', 'About first');
    insertAfter('third', 'About third');
    const [first] = refPositions();
    editor.commands.deleteRange({ from: first, to: first + 1 });
    expect(shownNumbers()).toEqual(['1']);
    expect(notes()).toEqual(['About third']);
  });

  it('removes the section with the last reference', () => {
    mkEditor();
    insertAfter('First', 'About first');
    const [ref] = refPositions();
    editor.commands.deleteRange({ from: ref, to: ref + 1 });
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(notes()).toEqual([]);
  });

  it('keeps a note’s text when its reference is cut and pasted elsewhere (reordering)', () => {
    mkEditor();
    insertAfter('First', 'About first');
    insertAfter('third', 'About third');
    const [first] = refPositions();
    const node = editor.state.doc.nodeAt(first)!.toJSON();
    editor.commands.deleteRange({ from: first, to: first + 1 });
    const [third] = refPositions();
    editor.chain().setTextSelection(third + 1).insertContent(node).run();
    expect(shownNumbers()).toEqual(['1', '2']);
    expect(notes()).toEqual(['About third', 'About first']);
  });
});
