// @vitest-environment happy-dom
/**
 * #603: galleries built by hand. Dropping image A beside image B makes the gallery
 * [A, B] or [B, A] by side, or adds A to B's gallery (which also reorders it); a
 * gallery image moves left/right from its toolbar; each is one undo step.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import * as Y from 'yjs';
import { createTrackedEditor } from './trackedEditor';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension, undo } from '@/components/editor/plugins/collaboration';
import { dispatchUndoStep, dropImageBeside, moveGalleryImage, type DropTarget } from '@/components/editor/nodes/galleryDrag';

let editor: Editor;
afterEach(() => editor.destroy());

const img = (alt: string) => `<img src="https://e.com/${alt}.png" alt="${alt}">`;

function mk(html: string) {
  editor = createTrackedEditor({ element: document.createElement('div'), extensions: createBaseExtensions(), content: html });
}

/** Position of the image with alt text `alt`. */
function posOf(alt: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.alt === alt) found = pos;
  });
  return found;
}

/** The doc as block types holding image alts / text, e.g. `gallery[A B] paragraph[x]`; no trailing empty line. */
function outline(doc: PMNode = editor.state.doc): string {
  const blocks: string[] = [];
  doc.forEach((block) => {
    const parts: string[] = [];
    block.forEach((n) => parts.push(n.type.name === 'image' ? n.attrs.alt : n.textContent));
    blocks.push(`${block.type.name}[${parts.join(' ')}]`);
  });
  return blocks.join(' ').replace(/ paragraph\[\]$/, '');
}

/** Drags image `alt` onto `side` of image `onto`, as a move. */
function drop(alt: string, onto: string, side: DropTarget['side']): boolean {
  const from = posOf(alt);
  const tr = dropImageBeside(editor.state, editor.state.doc.nodeAt(from)!, from, { pos: posOf(onto), side });
  if (!tr) return false;
  dispatchUndoStep(editor.view, tr);
  return true;
}

function move(alt: string, dir: -1 | 1): boolean {
  const tr = moveGalleryImage(editor.state, posOf(alt), dir);
  if (tr) editor.view.dispatch(tr);
  return !!tr;
}

describe('dropping an image beside another', () => {
  it('makes a gallery of the two, in drop-side order, with no empty line left behind', () => {
    mk(`<p>${img('A')}</p><p>${img('B')}</p><p>After</p>`);
    expect(drop('A', 'B', 'right')).toBe(true);
    expect(outline()).toBe('gallery[B A] paragraph[After]');

    mk(`<p>${img('A')}</p><p>${img('B')}</p>`);
    drop('A', 'B', 'left');
    expect(outline()).toBe('gallery[A B]');
  });

  it('merges two images that share a line', () => {
    mk(`<p>${img('A')}${img('B')}</p>`);
    drop('B', 'A', 'left');
    expect(outline()).toBe('gallery[B A]');
  });

  it('splits a line of text around the new gallery', () => {
    mk(`<p>${img('A')}</p><p>Before ${img('B')} after</p>`);
    drop('A', 'B', 'right');
    expect(outline()).toBe('paragraph[Before ] gallery[B A] paragraph[ after]');

    mk(`<p>${img('A')}</p><p>${img('B')} after</p>`);
    drop('A', 'B', 'left');
    expect(outline()).toBe('gallery[A B] paragraph[ after]');
  });

  it("adds the image to the target's gallery on that side", () => {
    mk(`<div data-gallery="row">${img('B')}${img('C')}</div><p>${img('A')}</p>`);
    drop('A', 'C', 'left');
    expect(outline()).toBe('gallery[B A C]');
  });

  it('reorders within a gallery', () => {
    mk(`<div data-gallery="row">${img('A')}${img('B')}${img('C')}</div>`);
    drop('A', 'C', 'right');
    expect(outline()).toBe('gallery[B C A]');
    drop('C', 'B', 'left');
    expect(outline()).toBe('gallery[C B A]');
  });

  it("dragged out of a 2-image gallery beside another image, the old gallery unwraps", () => {
    mk(`<div data-gallery="row">${img('A')}${img('B')}</div><p>${img('C')}</p>`);
    drop('B', 'C', 'right');
    expect(outline()).toBe('paragraph[A] gallery[C B]');
  });

  it('does nothing dropped on itself, or where a gallery cannot go (a list item line)', () => {
    mk(`<p>${img('A')}</p><ul><li><p>${img('B')}</p></li></ul>`);
    const from = posOf('A');
    expect(dropImageBeside(editor.state, editor.state.doc.nodeAt(from)!, from, { pos: from, side: 'left' })).toBeNull();
    expect(drop('A', 'B', 'left')).toBe(false);
  });

  it('copies (Alt-drag) leave the original where it was', () => {
    mk(`<p>${img('A')}</p><p>${img('B')}</p>`);
    const a = editor.state.doc.nodeAt(posOf('A'))!;
    editor.view.dispatch(dropImageBeside(editor.state, a, null, { pos: posOf('B'), side: 'right' })!);
    expect(outline()).toBe('paragraph[A] gallery[B A]');
  });
});

describe('the drop indicator', () => {
  /** Shows the indicator on the right of image `alt`, as a dragover would. */
  function showIndicator(alt: string) {
    const key = editor.state.plugins.find((p) => (p.spec.key as unknown as { key: string } | undefined)?.key === 'galleryDrop$')!.spec.key!;
    editor.view.dispatch(editor.state.tr.setMeta(key, { pos: posOf(alt), side: 'right' }));
  }
  const shown = () => editor.view.dom.querySelectorAll('[data-drop-side]').length;
  const leave = () => editor.view.dom.dispatchEvent(new Event('dragleave', { bubbles: true }));

  it('stays on a dragleave without a relatedTarget while the pointer is still over the editor', () => {
    mk(`<p>${img('A')}</p><p>${img('B')}</p>`);
    showIndicator('B');
    expect(shown()).toBe(1);
    const under = vi.spyOn(document, 'elementFromPoint').mockReturnValue(editor.view.dom.querySelector('img[alt="B"]'));
    leave();
    expect(shown()).toBe(1);
    under.mockReturnValue(null);
    leave();
    expect(shown()).toBe(0);
    under.mockRestore();
  });
});

describe('moving a gallery image from its toolbar', () => {
  it('swaps it with its neighbour, and stops at either end', () => {
    mk(`<div data-gallery="row">${img('A')}${img('B')}${img('C')}</div>`);
    expect(move('A', 1)).toBe(true);
    expect(outline()).toBe('gallery[B A C]');
    expect(move('C', -1)).toBe(true);
    expect(outline()).toBe('gallery[B C A]');
    expect(move('B', -1)).toBe(false);
    expect(move('A', 1)).toBe(false);
  });

  it('only moves images in a gallery', () => {
    mk(`<p>${img('A')}${img('B')}</p>`);
    expect(move('A', 1)).toBe(false);
  });
});

describe('undo', () => {
  const mkCollab = (html: string) => {
    editor = createTrackedEditor({
      element: document.createElement('div'),
      extensions: [...createBaseExtensions(), createCollaborationExtension(new Y.Doc().getXmlFragment('prosemirror'))],
    });
    editor.commands.setContent(html);
  };

  it('reverts a merge in one step, keeping the typing before it', () => {
    mkCollab(`<p>${img('A')}</p><p>${img('B')}</p><p>Typed</p>`);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' more');
    expect(drop('A', 'B', 'right')).toBe(true);
    expect(outline()).toBe('gallery[B A] paragraph[Typed more]');

    expect(undo(editor.state)).toBe(true);
    expect(outline()).toBe('paragraph[A] paragraph[B] paragraph[Typed more]');
  });

  it('brings a gallery back after an image is dragged out of it to the end of a line', () => {
    mkCollab(`<div data-gallery="row">${img('A')}${img('B')}</div><p>After</p>`);
    // What ProseMirror's own drop does: move the node, then select it where it landed
    const from = posOf('A');
    const end = editor.state.doc.content.size - 1;
    const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, from));
    tr.insert(end, tr.doc.nodeAt(from)!).delete(from, from + 1);
    tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(end) - 1));
    dispatchUndoStep(editor.view, tr);
    expect(outline()).toBe('paragraph[B] paragraph[After A]');

    expect(undo(editor.state)).toBe(true);
    expect(outline()).toBe('gallery[A B] paragraph[After]');
  });
});
