// @vitest-environment happy-dom
/**
 * Unit tests for the table-of-contents pure helpers.
 *
 * `extractHeadings` is exercised against a real TipTap editor doc (same
 * collaboration-backed setup as undoRedo.test.ts) so we cover the actual
 * ProseMirror node shapes; `readingTimeMinutes` pins the rounding edges.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension } from '@/components/editor/plugins/collaboration';
import { extractHeadings, readingTimeMinutes } from '@/lib/editor/extractHeadings';

function makeEditor(): Editor {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('prosemirror');
  const element = document.createElement('div');
  return new Editor({ element, extensions: [...createBaseExtensions(), createCollaborationExtension(fragment)] });
}

describe('extractHeadings', () => {
  it('returns headings in document order with correct levels and text', () => {
    const editor = makeEditor();
    editor.commands.setContent(
      '<h1>Intro</h1><p>some text</p><h2>Details</h2><p>more</p><h4>Footnote</h4>'
    );

    const headings = extractHeadings(editor.state.doc);

    expect(headings.map((h) => h.level)).toEqual([1, 2, 4]);
    expect(headings.map((h) => h.text)).toEqual(['Intro', 'Details', 'Footnote']);
    // Positions strictly increase in reading order.
    expect(headings[0].pos).toBeLessThan(headings[1].pos);
    expect(headings[1].pos).toBeLessThan(headings[2].pos);
  });

  it('returns an empty array for a doc with no headings', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>just a paragraph</p>');

    expect(extractHeadings(editor.state.doc)).toEqual([]);
  });
});

describe('readingTimeMinutes', () => {
  it('floors short notes at 1 minute', () => {
    expect(readingTimeMinutes(1)).toBe(1);
    expect(readingTimeMinutes(199)).toBe(1);
    expect(readingTimeMinutes(200)).toBe(1);
  });

  it('rounds to the nearest whole minute', () => {
    expect(readingTimeMinutes(500)).toBe(3); // 2.5 -> 3
    expect(readingTimeMinutes(300)).toBe(2); // 1.5 -> 2
    expect(readingTimeMinutes(1000)).toBe(5);
  });
});
