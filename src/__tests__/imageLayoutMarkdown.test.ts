/**
 * #581: an image's width and float alignment survive markdown (export, MCP) and
 * the share page. Plain images keep the `![alt](src)` form.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema, toMarkdown, createDoc } from '@/lib/agent/editEngine';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';

const roundTrip = (md: string) => toMarkdown(createDoc(md));
const imageAttrs = (md: string) => {
  const doc = yXmlFragmentToProseMirrorRootNode(createDoc(md).getXmlFragment('prosemirror'), editorSchema);
  let attrs: Record<string, unknown> | undefined;
  doc.descendants((n) => {
    if (n.type.name === 'image') attrs = n.attrs;
  });
  return attrs;
};
const share = (md: string) =>
  renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, md),
  );

describe('image width and alignment in markdown', () => {
  it('keeps a plain image as ![alt](src)', () => {
    expect(roundTrip('![A cat](https://example.com/cat.png)')).toBe('![A cat](https://example.com/cat.png)');
    expect(roundTrip('![A cat](https://example.com/cat.png "Tom")')).toBe('![A cat](https://example.com/cat.png "Tom")');
  });

  it('serializes width and align as an <img> and parses them back', () => {
    const md = '<img src="https://example.com/cat.png" alt="A cat" width="320" data-align="right">';
    expect(imageAttrs(md)).toMatchObject({ src: 'https://example.com/cat.png', alt: 'A cat', width: 320, align: 'right' });
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps width alone and align alone', () => {
    expect(roundTrip('<img src="https://e.com/a.png" alt="a" width="200">')).toBe('<img src="https://e.com/a.png" alt="a" width="200">');
    expect(roundTrip('<img src="https://e.com/a.png" alt="a" data-align="left">')).toBe('<img src="https://e.com/a.png" alt="a" data-align="left">');
  });

  it('round-trips an attachment image with an alt needing escapes', () => {
    const md = '<img src="attachment://f/jrnl_img0" alt="say &quot;hi&quot; &amp; bye" width="150">';
    expect(imageAttrs(md)).toMatchObject({ alt: 'say "hi" & bye', width: 150 });
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips an alt and title containing >', () => {
    const md = '<img src="https://e.com/a.png" alt="a &gt; b" title="x &gt; y" width="320">';
    expect(imageAttrs(md)).toMatchObject({ alt: 'a > b', title: 'x > y', width: 320 });
    expect(roundTrip(md)).toBe(md);
  });
});

describe('image caption in markdown (#583)', () => {
  it('round-trips a caption and an empty (hidden) caption', () => {
    const md = '<img src="https://e.com/a.png" alt="a" data-caption="Our &quot;logo&quot;">';
    expect(imageAttrs(md)).toMatchObject({ alt: 'a', caption: 'Our "logo"' });
    expect(roundTrip(md)).toBe(md);
    const hidden = '<img src="https://e.com/a.png" alt="a" data-caption="">';
    expect(imageAttrs(hidden)).toMatchObject({ caption: '' });
    expect(roundTrip(hidden)).toBe(hidden);
  });

  it('has no caption by default, so the alt shows', () => {
    expect(imageAttrs('![a](https://e.com/a.png)')).toMatchObject({ caption: null });
  });
});

describe('share page', () => {
  it('keeps data-caption on an img', () => {
    expect(share('<img src="https://example.com/cat.png" alt="A cat" data-caption="Tom">')).toContain('data-caption="Tom"');
  });

  it('keeps width and data-align on an img', () => {
    const html = share('<img src="https://example.com/cat.png" alt="A cat" width="320" data-align="right">');
    expect(html).toContain('width="320"');
    expect(html).toContain('data-align="right"');
  });

  it('still strips other attributes from an img', () => {
    const html = share('<img src="https://example.com/cat.png" alt="x" style="position:fixed" onerror="alert(1)" data-evil="1">');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('data-evil');
  });
});
