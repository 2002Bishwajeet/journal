/**
 * Agent edit engine (#166): markdown -> minimal Yjs change on a note's doc.
 * Data-integrity critical — these prove untouched blocks keep their Yjs items
 * (so note links / image layout survive) and that concurrent edits merge.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { updateYFragment } from 'y-prosemirror';
import {
  editorSchema,
  toMarkdown,
  createDoc,
  appendMarkdown,
  replaceInNote,
} from '@/lib/agent/editEngine';

const frag = (doc: Y.Doc) => doc.getXmlFragment('prosemirror');
const topElements = (doc: Y.Doc) => frag(doc).toArray() as Y.XmlElement[];
const sync = (a: Y.Doc, b: Y.Doc) => {
  const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, fromA);
  Y.applyUpdate(a, fromB);
};
const norm = (s: string) => s.split('\n').map((l) => l.trimEnd()).join('\n').trim();

/** A doc built straight from PM JSON (like the editor would), not from markdown. */
function docFromJSON(json: unknown): Y.Doc {
  const doc = new Y.Doc();
  const pm = editorSchema.nodeFromJSON(json);
  doc.transact(() => updateYFragment(doc, frag(doc), pm, { mapping: new Map(), isOMark: new Map() }));
  return doc;
}

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('editorSchema', () => {
  it('matches the editor: base extensions plus noteLink', () => {
    const nodes = Object.keys(editorSchema.nodes);
    for (const n of ['noteLink', 'image', 'taskList', 'taskItem', 'codeBlock', 'table', 'heading', 'bulletList', 'orderedList']) {
      expect(nodes).toContain(n);
    }
    const marks = Object.keys(editorSchema.marks);
    for (const m of ['bold', 'italic', 'link', 'code']) expect(marks).toContain(m);
  });
});

describe('round-trip createDoc -> toMarkdown', () => {
  const cases: Record<string, string> = {
    headings: '# One\n\n## Two\n\n### Three',
    'bullet list': '- a\n- b\n- c',
    'ordered list': '1. one\n2. two\n3. three',
    'task list': '- [x] done\n- [ ] todo',
    'fenced code with language': '```ts\nconst a = 1;\nconsole.log(a);\n```',
    link: 'see [the docs](https://example.com/docs) here',
    'bold and italic': 'a **bold** and *italic* word',
  };
  for (const [name, md] of Object.entries(cases)) {
    it(name, () => {
      expect(norm(toMarkdown(createDoc(md)))).toBe(norm(md));
    });
  }
});

describe('appendMarkdown', () => {
  it('replaces a lone empty paragraph instead of appending after it', () => {
    const doc = docFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] });
    appendMarkdown(doc, 'hello');
    expect(topElements(doc)).toHaveLength(1);
    expect(toMarkdown(doc)).toBe('hello');
  });

  it('appends after existing content, keeping the existing elements', () => {
    const doc = createDoc('# T\n\nfirst');
    const before = topElements(doc);
    appendMarkdown(doc, '- one\n- two');
    const after = topElements(doc);
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(toMarkdown(doc)).toBe('# T\n\nfirst\n\n- one\n- two');
  });

  it('merges with a concurrent human edit on another replica', () => {
    const A = createDoc('# T\n\nfirst\n\nsecond');
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A));

    appendMarkdown(A, 'agent line');
    // The user types into the `first` paragraph on B, concurrently.
    const firstText = topElements(B)[1].get(0) as Y.XmlText;
    firstText.insert(firstText.length, ' human');

    sync(A, B);
    const md = toMarkdown(A);
    expect(toMarkdown(B)).toBe(md);
    expect(md).toBe('# T\n\nfirst human\n\nsecond\n\nagent line');
  });

  it('keeps image (with layout attrs) and noteLink elements untouched', () => {
    const doc = docFromJSON({
      type: 'doc',
      content: [
        para('intro'),
        { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'attachment://f/jrnl_img0', width: 320 } }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'see ' }, { type: 'noteLink', attrs: { noteId: 'n1', label: 'Other' } }] },
      ],
    });
    const imageEl = topElements(doc)[1].get(0) as Y.XmlElement;
    const linkEl = topElements(doc)[2].get(1) as Y.XmlElement;
    const imageAttrs = { ...imageEl.getAttributes() };
    expect(imageAttrs.width).toBe(320);

    appendMarkdown(doc, 'x');

    const els = topElements(doc);
    expect(els).toHaveLength(4);
    expect(els[1].get(0)).toBe(imageEl);
    expect(imageEl.getAttributes()).toEqual(imageAttrs);
    expect(els[2].get(1)).toBe(linkEl);
    expect(linkEl.getAttribute('noteId')).toBe('n1');
    expect(linkEl.getAttribute('label')).toBe('Other');
  });
});

describe('replaceInNote', () => {
  it('rewrites only the matched block; other top-level elements are the same objects', () => {
    const doc = createDoc('first\n\nsecond\n\nthird');
    const [e1, e2, e3] = topElements(doc);
    replaceInNote(doc, 'second', 'SECOND');
    const after = topElements(doc);
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(e1);
    expect(after[2]).toBe(e3);
    expect(e2).toBeDefined();
    expect(toMarkdown(doc)).toBe('first\n\nSECOND\n\nthird');
  });

  it('leaves an untouched block holding a noteLink and image intact', () => {
    const doc = docFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'noteLink', attrs: { noteId: 'n1', label: 'L' } }, { type: 'image', attrs: { src: 'attachment://f/jrnl_img0', width: 200 } }] },
        para('change me'),
      ],
    });
    const [e1] = topElements(doc);
    const linkEl = e1.get(0);
    replaceInNote(doc, 'change me', 'changed');
    expect(topElements(doc)[0]).toBe(e1);
    expect(e1.get(0)).toBe(linkEl);
    expect((e1.get(1) as Y.XmlElement).getAttribute('width')).toBe(200);
    expect(topElements(doc)[1].toString()).toContain('changed');
  });

  it('can span several contiguous blocks, leaving the rest untouched', () => {
    const doc = createDoc('one\n\ntwo\n\nthree\n\nfour');
    const [e1, , , e4] = topElements(doc);
    replaceInNote(doc, 'two\n\nthree', 'merged');
    const after = topElements(doc);
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(e1);
    expect(after[2]).toBe(e4);
    expect(toMarkdown(doc)).toBe('one\n\nmerged\n\nfour');
  });

  it('merges with a concurrent human edit in another block', () => {
    const A = createDoc('first\n\nsecond\n\nthird');
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A));

    replaceInNote(A, 'second', 'SECOND');
    const t = topElements(B)[2].get(0) as Y.XmlText;
    t.insert(t.length, ' typed');

    sync(A, B);
    expect(toMarkdown(B)).toBe(toMarkdown(A));
    expect(toMarkdown(A)).toBe('first\n\nSECOND\n\nthird typed');
  });

  it('throws when old_text is not found', () => {
    const doc = createDoc('alpha\n\nbeta');
    expect(() => replaceInNote(doc, 'gamma', 'x')).toThrow('replace_in_note: old_text not found');
  });

  it('throws when old_text matches more than once', () => {
    const doc = createDoc('same\n\nsame');
    expect(() => replaceInNote(doc, 'same', 'x')).toThrow(
      'replace_in_note: old_text matches 2 times; include more surrounding text',
    );
  });

  it('refuses to edit a block containing a noteLink (it would be dropped)', () => {
    const doc = docFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link to ' }, { type: 'noteLink', attrs: { noteId: 'n1', label: 'L' } }] }],
    });
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => replaceInNote(doc, 'link to', 'x')).toThrow(
      'replace_in_note: the matched text is in a block with a note link or image; edit a different span',
    );
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('refuses to edit a block containing an image', () => {
    const doc = docFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'pic ' }, { type: 'image', attrs: { src: 'attachment://f/jrnl_img0' } }] }],
    });
    expect(() => replaceInNote(doc, 'pic', 'x')).toThrow('note link or image');
  });
});
