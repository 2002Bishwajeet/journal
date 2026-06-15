/**
 * Regression: a stray empty paragraph at the very START of the document (above a
 * list / horizontal rule / image) used to be undeletable — StarterKit's Backspace
 * (joinBackward) is a no-op there because nothing precedes it to merge into.
 * `deleteEmptyLeadingBlock` removes that empty leading block when another block
 * follows. Verified at the ProseMirror state level (no DOM needed).
 */
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { chainCommands, deleteSelection, joinBackward, selectNodeBackward } from '@tiptap/pm/commands';
import { createBaseExtensions, deleteEmptyLeadingBlock } from '@/components/editor/plugins/extensions';

const schema = getSchema(createBaseExtensions());

// StarterKit's default Backspace deletion chain (without our handler).
const defaultBackspace = chainCommands(deleteSelection, joinBackward, selectNodeBackward);

function run(
  cmd: (s: EditorState, d?: (tr: import('@tiptap/pm/state').Transaction) => void) => boolean,
  doc: ReturnType<typeof schema.node>,
  pos: number,
) {
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });
  let next = state;
  const handled = cmd(state, (tr) => { next = state.apply(tr); });
  return { handled, doc: next.doc };
}

const bulletList = () =>
  schema.node('bulletList', null, [
    schema.node('listItem', null, [schema.node('paragraph', null, [schema.text('item')])]),
  ]);

describe('deleteEmptyLeadingBlock (Backspace fix)', () => {
  it('default Backspace cannot remove an empty leading paragraph above a list', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph'), bulletList()]);
    const r = run(defaultBackspace, doc, 1);
    expect(r.handled).toBe(false); // the bug
    expect(r.doc.eq(doc)).toBe(true);
  });

  it('removes the empty leading paragraph above a bullet list', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph'), bulletList()]);
    const r = run(deleteEmptyLeadingBlock, doc, 1);
    expect(r.handled).toBe(true);
    expect(r.doc.childCount).toBe(1);
    expect(r.doc.firstChild?.type.name).toBe('bulletList');
  });

  it('removes the empty leading paragraph above a horizontal rule', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph'), schema.node('horizontalRule')]);
    const r = run(deleteEmptyLeadingBlock, doc, 1);
    expect(r.handled).toBe(true);
    expect(r.doc.childCount).toBe(1);
    expect(r.doc.firstChild?.type.name).toBe('horizontalRule');
  });

  it('does NOT touch a non-empty leading paragraph', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hi')]), bulletList()]);
    const r = run(deleteEmptyLeadingBlock, doc, 1);
    expect(r.handled).toBe(false);
    expect(r.doc.eq(doc)).toBe(true);
  });

  it('does NOT delete the only block (empty doc must keep one paragraph)', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph')]);
    const r = run(deleteEmptyLeadingBlock, doc, 1);
    expect(r.handled).toBe(false);
  });

  it('defers to default Backspace for an empty paragraph that is NOT first (joinBackward works)', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hi')]),
      schema.node('paragraph'),
      bulletList(),
    ]);
    // our handler declines (not the first block) ...
    expect(run(deleteEmptyLeadingBlock, doc, 5).handled).toBe(false);
    // ... and the default chain handles it by merging the empty para into "hi".
    expect(run(defaultBackspace, doc, 5).handled).toBe(true);
  });
});
