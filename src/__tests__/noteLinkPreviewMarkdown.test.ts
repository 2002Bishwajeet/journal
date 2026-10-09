/**
 * Note links and link preview cards in markdown (#561): the edit engine parses
 * `[label](journal:note/<id>)`, `[[Title]]` and `<url><!-- preview -->`, and
 * fragmentToMarkdown writes the same syntax back, so both round-trip.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { JSONContent } from '@tiptap/core';
import {
  editorSchema,
  toMarkdown,
  createDoc,
  appendMarkdown,
  replaceInNote,
  setMarkdown,
  type LinkTarget,
} from '@/lib/agent/editEngine';
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';

const frag = (doc: Y.Doc) => doc.getXmlFragment('prosemirror');
const topElements = (doc: Y.Doc) => frag(doc).toArray() as Y.XmlElement[];
const json = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(frag(doc), editorSchema).toJSON() as JSONContent;

function docFromJSON(content: JSONContent[]): Y.Doc {
  const doc = new Y.Doc();
  const pm = editorSchema.nodeFromJSON({ type: 'doc', content });
  doc.transact(() => updateYFragment(doc, frag(doc), pm, { mapping: new Map(), isOMark: new Map() }));
  return doc;
}

const TARGETS: LinkTarget[] = [
  { id: 'trip-1', title: 'Trip plan' },
  { id: 'pack-2', title: 'Packing list' },
];

const noteLink = (noteId: string, label: string): JSONContent => ({ type: 'noteLink', attrs: { noteId, label } });

describe('note links in markdown', () => {
  it('parses [label](journal:note/<id>) into a noteLink and writes it back the same way', () => {
    const markdown = 'See [Trip plan](journal:note/trip-1) before you go.';
    const doc = createDoc(markdown, TARGETS);
    expect(json(doc).content?.[0].content).toEqual([
      { type: 'text', text: 'See ' },
      noteLink('trip-1', 'Trip plan'),
      { type: 'text', text: ' before you go.' },
    ]);
    expect(toMarkdown(doc, TARGETS)).toBe(markdown);
  });

  it('escapes brackets and backslashes in the label so it round-trips', () => {
    const doc = docFromJSON([{ type: 'paragraph', content: [noteLink('trip-1', 'Plan [v2] a\\b')] }]);
    const markdown = toMarkdown(doc);
    expect(markdown).toBe('[Plan \\[v2\\] a\\\\b](journal:note/trip-1)');
    expect(json(createDoc(markdown)).content?.[0].content).toEqual([noteLink('trip-1', 'Plan [v2] a\\b')]);
  });

  it('resolves [[Title]] to the one visible note with that title, ignoring case', () => {
    const doc = createDoc('Pack from [[packing LIST]].', TARGETS);
    expect(json(doc).content?.[0].content?.[1]).toEqual(noteLink('pack-2', 'Packing list'));
    expect(toMarkdown(doc, TARGETS)).toBe('Pack from [Packing list](journal:note/pack-2).');
  });

  it('fails clearly when [[Title]] matches no visible note, or several', () => {
    expect(() => createDoc('[[Diary]]', TARGETS)).toThrow('Note link [[Diary]]: no note you can see has this title');
    const twins = [...TARGETS, { id: 'trip-3', title: 'Trip plan' }];
    expect(() => createDoc('[[Trip plan]]', twins)).toThrow(
      'Note link [[Trip plan]]: 2 notes have this title; link one by id: [Trip plan](journal:note/<id>)'
    );
  });

  it('keeps [[Title]] as text when there are no targets (markdown import)', () => {
    expect(toMarkdown(createDoc('A [[Wiki page]] link'))).toBe('A [[Wiki page]] link');
  });

  it('writes a link to a note the agent cannot see as its label only', () => {
    const doc = createDoc('See [Secret](journal:note/hidden-9) here.', TARGETS);
    expect(json(doc).content?.[0].content).toEqual([{ type: 'text', text: 'See Secret here.' }]);
  });

  it('reads a link to a note the agent cannot see as its label only; without targets it is a link', () => {
    const doc = docFromJSON([{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, noteLink('hidden-9', 'Secret')] }]);
    expect(toMarkdown(doc, TARGETS)).toBe('See Secret');
    expect(toMarkdown(doc)).toBe('See [Secret](journal:note/hidden-9)');
  });

  it('leaves a journal:note link inside inline code as code', () => {
    const markdown = '`[x](journal:note/trip-1)`';
    expect(toMarkdown(createDoc(markdown, TARGETS), TARGETS)).toBe(markdown);
  });

  it('replace_in_note edits a paragraph that holds a note link and keeps the link', () => {
    const doc = createDoc('Read [Trip plan](journal:note/trip-1) first.\n\nOther', TARGETS);
    replaceInNote(doc, 'first.', 'tonight.', undefined, TARGETS);
    expect(toMarkdown(doc, TARGETS)).toBe('Read [Trip plan](journal:note/trip-1) tonight.\n\nOther');
    expect(json(doc).content?.[0].content?.[1]).toEqual(noteLink('trip-1', 'Trip plan'));
  });

  it("replace_in_note refuses a block with a link to a note the agent can't see", () => {
    const doc = docFromJSON([{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, noteLink('hidden-9', 'Secret')] }]);
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => replaceInNote(doc, 'See', 'Read', undefined, TARGETS)).toThrow(
      "replace_in_note: the matched text is in a block with an image, toggle, callout or a link to a note you can't see; edit a different span"
    );
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('update_note with the markdown read back keeps a hidden link untouched', () => {
    const doc = docFromJSON([
      { type: 'paragraph', content: [{ type: 'text', text: 'See ' }, noteLink('hidden-9', 'Secret')] },
      { type: 'paragraph', content: [{ type: 'text', text: 'end' }] },
    ]);
    const [linkBlock] = topElements(doc);
    setMarkdown(doc, `${toMarkdown(doc, TARGETS)}\n\nmore`, undefined, TARGETS);
    expect(topElements(doc)[0]).toBe(linkBlock);
    expect(toMarkdown(doc)).toBe('See [Secret](journal:note/hidden-9)\n\nend\n\nmore');
  });

  it("renders on the share page as the label, without the note's id", () => {
    const markdown = toMarkdown(createDoc('See [Trip plan](journal:note/trip-1).'));
    const html = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, markdown)
    );
    expect(html).toContain('Trip plan');
    expect(html).not.toContain('journal:');
  });

  it('append_to_note resolves [[Title]] too', () => {
    const doc = createDoc('Start');
    appendMarkdown(doc, 'Next: [[Trip plan]]', undefined, TARGETS);
    expect(toMarkdown(doc, TARGETS)).toBe('Start\n\nNext: [Trip plan](journal:note/trip-1)');
  });
});

const card = (attrs: Record<string, unknown>): JSONContent => ({
  type: 'linkPreview',
  attrs: { url: '', title: '', description: '', image: null, imageWidth: null, imageHeight: null, ...attrs },
});

describe('link preview cards in markdown', () => {
  it.each([
    ['<https://example.com/a><!-- preview -->'],
    ['[Anything](https://example.com/a)<!-- preview -->'],
    ['https://example.com/a <!-- preview -->'],
  ])('parses %s into a card holding only the URL', (markdown) => {
    expect(json(createDoc(markdown)).content).toEqual([card({ url: 'https://example.com/a' })]);
  });

  it('writes an untitled card as <url><!-- preview -->, which reads back unchanged', () => {
    const markdown = 'Intro\n\n<https://example.com/a><!-- preview -->\n\nOutro';
    expect(toMarkdown(createDoc(markdown))).toBe(markdown);
  });

  it('writes a fetched card as [title](url)<!-- preview -->, without its description or image', () => {
    const doc = docFromJSON([card({ url: 'https://example.com/a', title: 'An [example]', description: 'Desc', image: 'data:image/png;base64,AQID' })]);
    expect(toMarkdown(doc)).toBe('[An \\[example\\]](https://example.com/a)<!-- preview -->');
  });

  it('update_note with the markdown read back keeps the card with its fetched data', () => {
    const doc = docFromJSON([
      card({ url: 'https://example.com/a', title: 'Example', description: 'Desc', image: 'data:image/png;base64,AQID' }),
      { type: 'paragraph', content: [{ type: 'text', text: 'end' }] },
    ]);
    const [cardEl] = topElements(doc);
    setMarkdown(doc, `${toMarkdown(doc)}\n\nmore`);
    expect(topElements(doc)[0]).toBe(cardEl);
    expect(cardEl.getAttribute('description')).toBe('Desc');
  });

  it('a link alone on its line without the marker stays a plain link', () => {
    expect(json(createDoc('<https://example.com/a>')).content?.[0].type).toBe('paragraph');
  });

  it('a marker after something that is not an http(s) URL is not a card', () => {
    expect(json(createDoc('ftp://example.com <!-- preview -->')).content?.[0].type).toBe('paragraph');
  });

  it('a card line inside a quote is a card; opening a list item it stays a link', () => {
    expect(json(createDoc('> <https://example.com/a><!-- preview -->')).content?.[0].content).toEqual([card({ url: 'https://example.com/a' })]);
    expect(toMarkdown(createDoc('- <https://example.com/a><!-- preview -->'))).toBe('- [https://example.com/a](https://example.com/a)');
  });

  it('markdown export writes note links and cards in the syntax get_note returns', async () => {
    const markdown = 'See [Trip plan](journal:note/trip-1).\n\n<https://example.com/a><!-- preview -->';
    const doc = createDoc(markdown, TARGETS);
    expect(await extractMarkdownFromYjs('n', doc)).toBe(toMarkdown(doc, TARGETS));
    expect(toMarkdown(doc, TARGETS)).toBe(markdown);
  });

  it('replace_in_note can rewrite a card line', () => {
    const doc = createDoc('<https://example.com/a><!-- preview -->\n\nend');
    replaceInNote(doc, 'example.com/a', 'example.org/b');
    expect(json(doc).content?.[0]).toEqual(card({ url: 'https://example.org/b' }));
  });
});
