/** #446: no header row by default; an empty GFM header line means "no header row". */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema, createDoc, toMarkdown } from '@/lib/agent/editEngine';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';

const pmJson = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), editorSchema).toJSON();
const cellTypes = (doc: Y.Doc) => {
  const table = pmJson(doc).content[0];
  return table.content.map((row: { content: { type: string }[] }) => row.content.map((c) => c.type));
};

const HEADERLESS = '|  |  |\n| --- | --- |\n| Topic | X |';

describe('headerless tables', () => {
  it('parses an empty header line as no header row', () => {
    expect(cellTypes(createDoc(HEADERLESS))).toEqual([['tableCell', 'tableCell']]);
  });

  it('keeps a header row that has text', () => {
    const doc = createDoc('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(cellTypes(doc)).toEqual([['tableHeader', 'tableHeader'], ['tableCell', 'tableCell']]);
  });

  it('round-trips a headerless table', () => {
    const doc = createDoc(HEADERLESS);
    expect(toMarkdown(doc)).toBe(HEADERLESS);
    expect(pmJson(createDoc(toMarkdown(doc)))).toEqual(pmJson(doc));
  });

  it('round-trips a table with a header row unchanged', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(toMarkdown(createDoc(md))).toBe(md);
  });

  it('share pipeline renders no thead for an empty header', () => {
    const render = (md: string) =>
      renderToStaticMarkup(createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, md));
    const html = render(HEADERLESS);
    expect(html).toContain('<table>');
    expect(html).not.toContain('<thead');
    expect(render('| A | B |\n| --- | --- |\n| 1 | 2 |')).toContain('<thead');
  });
});
