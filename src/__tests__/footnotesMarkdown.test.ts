/**
 * #518: footnotes read and written as `[^n]` markdown by the agent edit engine
 * and the serializer (export, share page), and rendered on the share page.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { Node as PMNode } from '@tiptap/pm/model';
import { editorSchema, toMarkdown, createDoc, appendMarkdown, replaceInNote } from '@/lib/agent/editEngine';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import type * as Y from 'yjs';

const roundTrip = (md: string) => toMarkdown(createDoc(md));
const pmDoc = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), editorSchema);

/** Reference ids in text order, and footnote ids in section order. */
function linkage(doc: PMNode) {
  const refs: string[] = [];
  const notes: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'footnoteReference') refs.push(node.attrs.id);
    if (node.type.name === 'footnote') notes.push(node.attrs.id);
  });
  return { refs, notes };
}

describe('footnote markdown round-trip', () => {
  it.each([
    ['one footnote', 'Hello[^1].\n\n[^1]: The note.'],
    ['two footnotes', 'First[^1] and second[^2].\n\n[^1]: One.\n[^2]: Two.'],
    ['a footnote referenced twice', 'Here[^1] and here again[^1].\n\n[^1]: Shared.'],
    ['a footnote with formatting', 'Text[^1]\n\n[^1]: See **this** and [a link](https://example.com).'],
    ['a footnote of two paragraphs', 'Text[^1]\n\n[^1]: First paragraph.\n\n    Second paragraph.'],
    ['footnotes across blocks', '# Trip[^1]\n\n- Day one[^2]\n- Day two\n\n> Quote[^3]\n\n[^1]: Heading note.\n[^2]: List note.\n[^3]: Quote note.'],
  ])('is lossless for %s', (_, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it('links each reference to its footnote, with the section last', () => {
    const doc = pmDoc(createDoc('A[^1] b[^2].\n\n[^1]: One.\n[^2]: Two.'));
    const { refs, notes } = linkage(doc);
    expect(refs).toHaveLength(2);
    expect(notes).toEqual(refs);
    expect(doc.lastChild?.type.name).toBe('footnotes');
    expect(doc.lastChild?.textContent).toBe('One.Two.');
  });

  it('numbers footnotes by reference order, whatever their labels and definition order', () => {
    const md = 'A[^b] then[^a].\n\n[^a]: Second.\n\n[^b]: First.';
    expect(roundTrip(md)).toBe('A[^1] then[^2].\n\n[^1]: First.\n[^2]: Second.');
  });

  it('moves definitions written mid-note to the end', () => {
    expect(roundTrip('A[^1].\n\n[^1]: Note.\n\nMore text.')).toBe('A[^1].\n\nMore text.\n\n[^1]: Note.');
  });

  it('drops a definition no reference uses, and gives an undefined reference an empty note', () => {
    expect(roundTrip('Plain.\n\n[^1]: Orphan.')).toBe('Plain.');
    expect(roundTrip('Dangling[^1].')).toBe('Dangling[^1].\n\n[^1]:');
  });

  it('keeps `[^x]: ` lines inside code as code', () => {
    const md = '```\n[^1]: not a footnote\n```';
    expect(roundTrip(md)).toBe(md);
  });
});

describe('footnotes through agent edits', () => {
  it('numbers an appended footnote after the existing ones', () => {
    const doc = createDoc('A[^1].\n\n[^1]: Old.');
    appendMarkdown(doc, 'B[^1].\n\n[^1]: New.');
    expect(toMarkdown(doc)).toBe('A[^1].\n\nB[^2].\n\n[^1]: Old.\n[^2]: New.');
  });

  it('points an appended reference with no definition at the existing footnote', () => {
    const doc = createDoc('A[^1].\n\n[^1]: Old.');
    appendMarkdown(doc, 'See also[^1].');
    expect(toMarkdown(doc)).toBe('A[^1].\n\nSee also[^1].\n\n[^1]: Old.');
  });

  it('keeps a footnote linked when its sentence is replaced', () => {
    const doc = createDoc('Intro[^1].\n\nMiddle[^2].\n\n[^1]: One.\n[^2]: Two.');
    const before = linkage(pmDoc(doc)).notes;
    replaceInNote(doc, 'Middle[^2].', 'Changed middle[^2].');
    expect(toMarkdown(doc)).toBe('Intro[^1].\n\nChanged middle[^2].\n\n[^1]: One.\n[^2]: Two.');
    expect(linkage(pmDoc(doc)).notes).toEqual(before);
  });

  it('edits a footnote’s text in place', () => {
    const doc = createDoc('A[^1] b[^2].\n\n[^1]: One.\n[^2]: Two.');
    replaceInNote(doc, '[^2]: Two.', '[^2]: Two, revised.');
    expect(toMarkdown(doc)).toBe('A[^1] b[^2].\n\n[^1]: One.\n[^2]: Two, revised.');
  });

  it('renumbers and drops the footnote when its reference is deleted', () => {
    const doc = createDoc('A[^1] b[^2].\n\n[^1]: One.\n[^2]: Two.');
    replaceInNote(doc, 'A[^1] b', 'A b');
    expect(toMarkdown(doc)).toBe('A b[^1].\n\n[^1]: Two.');
  });
});

describe('footnotes on the share page', () => {
  const render = (md: string) =>
    renderToStaticMarkup(createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, md));

  it('links every reference to its note and every back link to its reference', () => {
    const html = render(toMarkdown(createDoc('A[^1] b[^2].\n\n[^1]: One.\n[^2]: Two.')));
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const targets = [...html.matchAll(/<a href="#([^"]+)"[^>]*data-footnote-(?:ref|backref)/g)].map((m) => m[1]);
    expect(targets).toHaveLength(4);
    for (const target of targets) expect(ids).toContain(target);
    // The sanitizer's prefix still guards against DOM clobbering.
    for (const id of ids) expect(id.startsWith('user-content-')).toBe(true);
  });
});
