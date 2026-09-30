/**
 * Agent edit engine (#392): callout and toggle parse from the markdown the
 * serializer emits, so a note an agent read can be written back unchanged.
 * Link previews are out: a card serializes to `[title](url)`, the same string
 * as a plain link, so a lone link line must stay a paragraph.
 */
import { describe, it, expect } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema, toMarkdown, createDoc } from '@/lib/agent/editEngine';
import { CALLOUT_VARIANTS } from '@/components/editor/nodes/calloutVariants';

/** markdown -> doc, as ProseMirror JSON. */
const parse = (md: string) =>
  yXmlFragmentToProseMirrorRootNode(createDoc(md).getXmlFragment('prosemirror'), editorSchema).toJSON().content;
const roundTrip = (md: string) => toMarkdown(createDoc(md));
const types = (nodes: { type: string }[]) => nodes.map((n) => n.type);
const para = (text: string) => ({ type: 'paragraph', attrs: expect.anything(), content: [{ type: 'text', text }] });

const NESTED_BODY = ['First paragraph', '', 'Second paragraph', '', '- one', '- two', '', '```ts', 'const a = 1;', '', '  indented();', '```'];

describe('callout from markdown', () => {
  it.each(CALLOUT_VARIANTS)('parses and round-trips a %s callout', (variant) => {
    const md = `> [!${variant}]\n> Body text`;
    expect(parse(md)).toEqual([{ type: 'callout', attrs: { variant }, content: [para('Body text')] }]);
    expect(roundTrip(md)).toBe(md);
  });

  it('parses and round-trips an empty callout', () => {
    const md = '> [!warning]\n>';
    const [callout, ...rest] = parse(md);
    expect(rest).toEqual([]);
    expect(callout).toMatchObject({ type: 'callout', attrs: { variant: 'warning' } });
    expect(types(callout.content)).toEqual(['paragraph']);
    expect(callout.content[0].content).toBeUndefined();
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps a second paragraph, a list and a code block inside the callout', () => {
    const md = ['> [!tip]', ...NESTED_BODY.map((l) => (l ? `> ${l}` : '>'))].join('\n');
    const [callout, ...rest] = parse(md);
    expect(rest).toEqual([]);
    expect(callout.type).toBe('callout');
    expect(types(callout.content)).toEqual(['paragraph', 'paragraph', 'bulletList', 'codeBlock']);
    expect(callout.content[3]).toMatchObject({ attrs: { language: 'ts' }, content: [{ text: 'const a = 1;\n\n  indented();' }] });
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips between other blocks', () => {
    const md = 'before\n\n> [!error]\n> inside\n\nafter';
    expect(types(parse(md))).toEqual(['paragraph', 'callout', 'paragraph']);
    expect(roundTrip(md)).toBe(md);
  });
});

describe('toggle from markdown', () => {
  const toggle = (summary: string, body: string) => `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;

  it('parses and round-trips a toggle', () => {
    const md = toggle('Title', 'Body text');
    expect(parse(md)).toEqual([{ type: 'toggle', attrs: { summary: 'Title' }, content: [para('Body text')] }]);
    expect(roundTrip(md)).toBe(md);
  });

  it('un-escapes a summary containing <, & and "', () => {
    const md = toggle('a &lt; b &amp; &quot;c&quot; &gt; d &amp;lt;', 'Body');
    expect(parse(md)[0].attrs).toEqual({ summary: 'a < b & "c" > d &lt;' });
    expect(roundTrip(md)).toBe(md);
  });

  it('parses and round-trips an empty toggle', () => {
    const md = toggle('Empty', '');
    const [node, ...rest] = parse(md);
    expect(rest).toEqual([]);
    expect(node).toMatchObject({ type: 'toggle', attrs: { summary: 'Empty' } });
    expect(types(node.content)).toEqual(['paragraph']);
    expect(node.content[0].content).toBeUndefined();
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps a second paragraph, a list and a code block inside the toggle', () => {
    const md = toggle('More', NESTED_BODY.join('\n'));
    const [node, ...rest] = parse(md);
    expect(rest).toEqual([]);
    expect(node.type).toBe('toggle');
    expect(types(node.content)).toEqual(['paragraph', 'paragraph', 'bulletList', 'codeBlock']);
    expect(node.content[3]).toMatchObject({ attrs: { language: 'ts' }, content: [{ text: 'const a = 1;\n\n  indented();' }] });
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips between other blocks', () => {
    const md = `before\n\n${toggle('T', 'inside')}\n\nafter`;
    expect(types(parse(md))).toEqual(['paragraph', 'toggle', 'paragraph']);
    expect(roundTrip(md)).toBe(md);
  });

  it('nests a toggle and a callout inside a toggle', () => {
    const md = toggle('Outer', `${toggle('Inner', 'deep')}\n\n> [!info]\n> noted\n\nlast`);
    const [outer, ...rest] = parse(md);
    expect(rest).toEqual([]);
    expect(outer.attrs).toEqual({ summary: 'Outer' });
    expect(types(outer.content)).toEqual(['toggle', 'callout', 'paragraph']);
    expect(outer.content[0]).toMatchObject({ attrs: { summary: 'Inner' }, content: [{ content: [{ text: 'deep' }] }] });
    expect(roundTrip(md)).toBe(md);
  });

  it('nests a toggle inside a callout', () => {
    const md = ['> [!info]', ...toggle('In', 'body').split('\n').map((l) => (l ? `> ${l}` : '>'))].join('\n');
    const [callout] = parse(md);
    expect(callout.type).toBe('callout');
    expect(callout.content).toEqual([{ type: 'toggle', attrs: { summary: 'In' }, content: [para('body')] }]);
    expect(roundTrip(md)).toBe(md);
  });
});

describe('ordinary markdown still parses as before', () => {
  it('a plain blockquote stays a blockquote', () => {
    const md = '> just a quote\n>\n> second paragraph';
    expect(parse(md)).toEqual([{ type: 'blockquote', content: [para('just a quote'), para('second paragraph')] }]);
    expect(roundTrip(md)).toBe(md);
  });

  it('a blockquote that mentions [!info] mid-sentence stays a blockquote', () => {
    const md = '> see the [!info] marker\n> [!info] also here';
    expect(parse(md)).toEqual([{ type: 'blockquote', content: [para('see the [!info] marker\n[!info] also here')] }]);
  });

  it('a blockquote whose first paragraph is only [!info] stays a blockquote', () => {
    // What the serializer emits for blockquote(p("[!info]"), p("more")).
    const md = '> [!info]\n>\n> more';
    expect(parse(md)).toEqual([{ type: 'blockquote', content: [para('[!info]'), para('more')] }]);
    expect(roundTrip(md)).toBe(md);
  });

  it('an unknown callout variant stays a blockquote', () => {
    expect(parse('> [!note]\n> body')).toEqual([{ type: 'blockquote', content: [para('[!note]\nbody')] }]);
  });

  it('callout markdown inside a list item stays a blockquote and keeps the whole item', () => {
    // The serializer never nests one there; parsing it would drop the item.
    expect(parse('- item\n  > [!info]\n  > x\n  trailing\n- next')).toMatchObject([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para('item'), { type: 'blockquote', content: [para('[!info]\nx\ntrailing')] }] },
          { type: 'listItem', content: [para('next')] },
        ],
      },
    ]);
  });

  it('toggle markdown inside a list item stays literal text and keeps the whole item', () => {
    const md = '- item\n  <details>\n  <summary>T</summary>\n\n  body\n\n  </details>\n- next';
    expect(parse(md)).toMatchObject([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para('item'), para('<details>\n<summary>T</summary>'), para('body'), para('</details>')] },
          { type: 'listItem', content: [para('next')] },
        ],
      },
    ]);
  });

  it('a <details> block that is not in the serializer shape stays literal text', () => {
    const md = '<details open>\n<summary>Title</summary>\n\nBody\n\n</details>';
    expect(parse(md)).toEqual([para('<details open>\n<summary>Title</summary>'), para('Body'), para('</details>')]);
  });

  it('an unclosed <details> stays literal text', () => {
    const md = '<details>\n<summary>Title</summary>\n\nBody';
    expect(parse(md)).toEqual([para('<details>\n<summary>Title</summary>'), para('Body')]);
  });

  it('a lone [title](url) line stays a paragraph with a link', () => {
    const md = '[A site](https://a.com)';
    const [p, ...rest] = parse(md);
    expect(rest).toEqual([]);
    expect(p.type).toBe('paragraph');
    expect(p.content).toEqual([
      { type: 'text', text: 'A site', marks: [{ type: 'link', attrs: expect.objectContaining({ href: 'https://a.com' }) }] },
    ]);
    expect(roundTrip(md)).toBe(md);
  });

  it('a link followed by a quote stays a paragraph and a blockquote', () => {
    const md = '[A site](https://a.com)\n\n> Desc';
    expect(types(parse(md))).toEqual(['paragraph', 'blockquote']);
    expect(roundTrip(md)).toBe(md);
  });
});
