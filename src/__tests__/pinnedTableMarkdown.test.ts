/** #1528: a table pins its first column only when it opted in, and `<!-- pin -->` carries that. */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema, createDoc, toMarkdown } from '@/lib/agent/editEngine';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';

const pmJson = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), editorSchema).toJSON();
const tableAttrs = (doc: Y.Doc, at = 0) => pmJson(doc).content[at].attrs;

const TABLE = '| A | B |\n| --- | --- |\n| 1 | 2 |';
const PINNED = `${TABLE}\n<!-- pin -->`;

describe('pinned table markdown', () => {
  it('parses the marker into the attribute', () => {
    expect(tableAttrs(createDoc(PINNED)).pinFirstColumn).toBe(true);
  });

  it('leaves a table without the marker unpinned', () => {
    expect(tableAttrs(createDoc(TABLE)).pinFirstColumn).toBe(false);
  });

  it('round-trips a pinned table with its marker', () => {
    const doc = createDoc(PINNED);
    expect(toMarkdown(doc)).toBe(PINNED);
    expect(pmJson(createDoc(toMarkdown(doc)))).toEqual(pmJson(doc));
  });

  it('writes no marker for an unpinned table', () => {
    expect(toMarkdown(createDoc(TABLE))).toBe(TABLE);
  });

  it('pins only the table that has the marker, and keeps the text around them', () => {
    const md = `${PINNED}\n\nbetween\n\n${TABLE}`;
    const doc = createDoc(md);
    expect(tableAttrs(doc, 0).pinFirstColumn).toBe(true);
    expect(tableAttrs(doc, 2).pinFirstColumn).toBe(false);
    expect(toMarkdown(doc)).toBe(md);
  });

  it('share pipeline marks only the table that has the marker', () => {
    const render = (md: string) =>
      renderToStaticMarkup(createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, md));
    expect(render(PINNED)).toContain('data-pin-first');
    expect(render(TABLE)).not.toContain('data-pin-first');
    expect(render(`${PINNED}\n\n${TABLE}`).match(/data-pin-first/g)).toHaveLength(1);
  });
});
