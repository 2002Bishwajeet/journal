import { describe, it, expect } from 'vitest';
import { extractNoteLinkIds } from '@/lib/editor/extractNoteLinkIds';
import type { JSONContent } from '@tiptap/core';

const A = '40000000-0000-0000-0000-000000000001';
const B = '40000000-0000-0000-0000-000000000002';

const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const text = (t: string): JSONContent => ({ type: 'text', text: t });
const noteLink = (noteId: string, label = 'X'): JSONContent => ({
  type: 'noteLink',
  attrs: { noteId, label },
});

describe('extractNoteLinkIds', () => {
  it('returns [] for an empty / link-free document', () => {
    const doc: JSONContent = { type: 'doc', content: [para(text('hello world'))] };
    expect(extractNoteLinkIds(doc)).toEqual([]);
  });

  it('collects noteIds from noteLink nodes anywhere in the tree', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        para(text('see '), noteLink(A), text(' and '), noteLink(B)),
      ],
    };
    expect(extractNoteLinkIds(doc).sort()).toEqual([A, B].sort());
  });

  it('dedupes repeated links to the same note', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [para(noteLink(A)), para(noteLink(A))],
    };
    expect(extractNoteLinkIds(doc)).toEqual([A]);
  });

  it('finds links nested inside other block types (lists, quotes)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'bulletList', content: [
              { type: 'listItem', content: [para(noteLink(B))] },
            ] },
          ],
        },
      ],
    };
    expect(extractNoteLinkIds(doc)).toEqual([B]);
  });

  it('ignores noteLink nodes without a noteId', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [para({ type: 'noteLink', attrs: { label: 'broken' } })],
    };
    expect(extractNoteLinkIds(doc)).toEqual([]);
  });

  it('handles null / empty input safely', () => {
    expect(extractNoteLinkIds(null as unknown as JSONContent)).toEqual([]);
    expect(extractNoteLinkIds({} as JSONContent)).toEqual([]);
  });
});
