// @vitest-environment happy-dom
/**
 * #601: an image gallery holds two or more images side by side in rows. It survives
 * markdown (export, MCP) and the share page, and unwraps once one image is left.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { Editor } from '@tiptap/core';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { galleryRowBreaks } from '@/components/editor/nodes/galleryLayout';
import { editorSchema, toMarkdown, createDoc } from '@/lib/agent/editEngine';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';

const GALLERY_MD = [
  '<div data-gallery="row">',
  '',
  '![A](https://e.com/a.png) <img src="https://e.com/b.png" alt="B" data-caption="Bee"> ![C](https://e.com/c.png)',
  '',
  '</div>',
].join('\n');

const pmDoc = (md: string) => yXmlFragmentToProseMirrorRootNode(createDoc(md).getXmlFragment('prosemirror'), editorSchema);
const share = (md: string) =>
  renderToStaticMarkup(createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, md));
const galleryOf = (n: number) =>
  `<div data-gallery="row">\n\n${Array.from({ length: n }, (_, i) => `![${i}](https://e.com/${i}.png)`).join(' ')}\n\n</div>`;

describe('gallery rows', () => {
  it('keeps 2 or 3 images in one row and balances wider galleries', () => {
    expect(galleryRowBreaks(2)).toEqual([]);
    expect(galleryRowBreaks(4)).toEqual([{ index: 2, modes: ['wide', 'narrow'] }]);
    expect(galleryRowBreaks(7).filter((b) => b.modes.includes('wide')).map((b) => b.index)).toEqual([3, 5]);
  });

  it('puts two per row on a phone, so 3 wraps but 2 stays side by side', () => {
    expect(galleryRowBreaks(3)).toEqual([{ index: 2, modes: ['narrow'] }]);
    expect(galleryRowBreaks(5).filter((b) => b.modes.includes('narrow')).map((b) => b.index)).toEqual([2, 4]);
  });
});

describe('gallery in markdown', () => {
  it('parses into one gallery holding the images in order, captions kept', () => {
    const doc = pmDoc(GALLERY_MD);
    expect(doc.childCount).toBe(1);
    const gallery = doc.firstChild!;
    expect(gallery.type.name).toBe('gallery');
    expect(gallery.attrs.layout).toBe('row');
    const images: Record<string, unknown>[] = [];
    gallery.forEach((n) => images.push({ type: n.type.name, alt: n.attrs.alt, caption: n.attrs.caption }));
    expect(images).toEqual([
      { type: 'image', alt: 'A', caption: null },
      { type: 'image', alt: 'B', caption: 'Bee' },
      { type: 'image', alt: 'C', caption: null },
    ]);
  });

  it('round-trips editor -> markdown -> editor unchanged', () => {
    expect(toMarkdown(createDoc(GALLERY_MD))).toBe(GALLERY_MD);
    const around = `Before.\n\n${GALLERY_MD}\n\nAfter.`;
    expect(toMarkdown(createDoc(around))).toBe(around);
  });

  it('reads a gallery of one image as a plain image', () => {
    const doc = pmDoc('<div data-gallery="row">\n\n![A](https://e.com/a.png)\n\n</div>');
    expect(doc.firstChild!.type.name).toBe('paragraph');
    expect(doc.firstChild!.firstChild!.type.name).toBe('image');
  });
});

describe('gallery on the share page', () => {
  it('renders the images as the gallery row itself, no paragraph between', () => {
    const html = share(GALLERY_MD);
    expect(html).toContain('<div data-gallery="row"><img src="https://e.com/a.png" alt="A"/>');
    expect(html).toContain('data-caption="Bee"/><span class="gallery-break" data-row-break="narrow" aria-hidden="true"></span><img src="https://e.com/c.png"');
    expect(html).not.toContain('<p>');
    expect(html.match(/<img /g)).toHaveLength(3);
  });

  it('puts the row breaks before the right images', () => {
    const html = share(galleryOf(4));
    expect(html).toContain('alt="1"/><span class="gallery-break" data-row-break="wide narrow" aria-hidden="true"></span><img src="https://e.com/2.png"');
  });

  it('strips any other div attribute', () => {
    expect(share('<div data-gallery="row" onclick="x()" style="color:red">\n\n![A](https://e.com/a.png)\n\n</div>')).not.toMatch(/onclick|style/);
  });
});

describe('gallery in the editor', () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  const mk = (n: number) => {
    const images = Array.from({ length: n }, (_, i) => `<img src="https://e.com/${i}.png" alt="img${i}">`).join('');
    editor = new Editor({ element: document.createElement('div'), extensions: createBaseExtensions(), content: `<div data-gallery="row">${images}</div><p>After</p>` });
  };

  it('draws a row break before the third of four images', () => {
    mk(4);
    const breaks = editor.view.dom.querySelectorAll('[data-gallery] > .gallery-break');
    expect(breaks).toHaveLength(1);
    expect(breaks[0].getAttribute('data-row-break')).toBe('wide narrow');
  });

  it('unwraps to a plain image when images are deleted down to one', () => {
    mk(2);
    expect(editor.state.doc.firstChild!.type.name).toBe('gallery');
    editor.commands.deleteRange({ from: 1, to: 2 });
    const first = editor.state.doc.firstChild!;
    expect(first.type.name).toBe('paragraph');
    expect(first.childCount).toBe(1);
    expect(first.firstChild!.attrs.alt).toBe('img1');
  });
});
