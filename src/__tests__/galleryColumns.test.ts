// @vitest-environment happy-dom
/**
 * #1367: the author sets the images per row of a gallery. `columns` is an optional integer
 * from 1 to 6 on the gallery node (unset is automatic); it survives markdown, the share
 * page and the feed, and a phone shows two at most.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import type { Editor } from '@tiptap/core';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { galleryBreaks, galleryRowBreaks, toGalleryColumns } from '@/components/editor/nodes/galleryLayout';
import { editorSchema, toMarkdown, createDoc } from '@/lib/agent/editEngine';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import { createTrackedEditor } from './trackedEditor';

const md = (open: string, count = 6) =>
  `<div ${open}>\n\n${Array.from({ length: count }, (_, i) => `![${i}](https://e.com/${i}.png)`).join(' ')}\n\n</div>`;
const pmDoc = (markdown: string) => yXmlFragmentToProseMirrorRootNode(createDoc(markdown).getXmlFragment('prosemirror'), editorSchema);
const share = (markdown: string) =>
  renderToStaticMarkup(createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, markdown));
const indexes = (breaks: ReturnType<typeof galleryRowBreaks>, mode: string) =>
  breaks.filter((b) => b.modes.includes(mode as 'wide')).map((b) => b.index);

describe('toGalleryColumns', () => {
  it('keeps an integer from 1 to 6, as a number or a string, and drops anything else', () => {
    expect([1, 3, 6, '4', ' 2 '].map(toGalleryColumns)).toEqual([1, 3, 6, 4, 2]);
    for (const bad of [0, 7, 2.5, -1, 'x', '3.5', '', null, undefined, NaN, {}]) expect(toGalleryColumns(bad)).toBeNull();
  });
});

describe('row grouping with columns', () => {
  it('is unchanged without columns', () => {
    expect(galleryRowBreaks(7, null)).toEqual(galleryRowBreaks(7));
    expect(galleryBreaks('row', null, 7)).toEqual(galleryRowBreaks(7));
  });

  it('puts exactly N per row in a grid', () => {
    expect(indexes(galleryBreaks('grid', 3, 7), 'wide')).toEqual([3, 6]);
    expect(indexes(galleryBreaks('grid', 4, 6), 'wide')).toEqual([4]);
    expect(indexes(galleryBreaks('grid', 6, 4), 'wide')).toEqual([]);
  });

  it('puts at most N per row in a row, balanced', () => {
    expect(indexes(galleryBreaks('row', 2, 5), 'wide')).toEqual([2, 4]);
    expect(indexes(galleryBreaks('row', 5, 6), 'wide')).toEqual([3]);
    expect(indexes(galleryBreaks('row', 1, 3), 'wide')).toEqual([1, 2]);
  });

  it('shows min(N, 2) per row on a phone', () => {
    expect(indexes(galleryBreaks('grid', 5, 6), 'narrow')).toEqual([2, 4]);
    expect(indexes(galleryBreaks('row', 3, 5), 'narrow')).toEqual([2, 4]);
    expect(indexes(galleryBreaks('grid', 1, 3), 'narrow')).toEqual([1, 2]);
  });

  it('has no breaks in a grid without columns, masonry or a carousel', () => {
    expect(galleryBreaks('grid', null, 6)).toEqual([]);
    expect(galleryBreaks('masonry', 3, 6)).toEqual([]);
    expect(galleryBreaks('carousel', 3, 6)).toEqual([]);
  });
});

describe('columns in markdown', () => {
  it('round-trips with data-columns', () => {
    const grid = md('data-gallery="grid" data-columns="3"');
    expect(pmDoc(grid).firstChild!.attrs).toMatchObject({ layout: 'grid', columns: 3 });
    expect(toMarkdown(createDoc(grid))).toBe(grid);
    const around = `Before.\n\n${md('data-gallery="masonry" data-columns="2"')}\n\nAfter.`;
    expect(toMarkdown(createDoc(around))).toBe(around);
  });

  it('round-trips without data-columns', () => {
    const row = md('data-gallery="row"');
    expect(pmDoc(row).firstChild!.attrs.columns).toBeNull();
    expect(toMarkdown(createDoc(row))).toBe(row);
  });

  it('drops a value that is not 1 to 6', () => {
    for (const bad of ['0', '7', '99', 'x', '']) {
      expect(pmDoc(md(`data-gallery="grid" data-columns="${bad}"`)).firstChild!.attrs.columns).toBeNull();
      expect(toMarkdown(createDoc(md(`data-gallery="grid" data-columns="${bad}"`)))).toBe(md('data-gallery="grid"'));
    }
  });
});

describe('columns in the editor', () => {
  let editor: Editor;
  afterEach(() => editor.destroy());
  const mk = (html: string) => {
    editor = createTrackedEditor({ element: document.createElement('div'), extensions: createBaseExtensions(), content: html });
  };
  const imgs = Array.from({ length: 6 }, (_, i) => `<img src="https://e.com/${i}.png" alt="${i}">`).join('');

  it('reads and writes data-columns as html', () => {
    mk(`<div data-gallery="grid" data-columns="4">${imgs}</div>`);
    expect(editor.state.doc.firstChild!.attrs).toMatchObject({ layout: 'grid', columns: 4 });
    expect(editor.getHTML()).toContain('data-gallery="grid" data-columns="4"');
    editor.destroy();
    mk(`<div data-gallery="grid">${imgs}</div>`);
    expect(editor.state.doc.firstChild!.attrs.columns).toBeNull();
    expect(editor.getHTML()).not.toContain('data-columns');
  });

  it('draws the breaks of a grid with columns, and sets them from the Per row select', () => {
    mk(`<div data-gallery="grid">${imgs}</div>`);
    const dom = editor.view.dom;
    expect(dom.querySelectorAll('.gallery-break')).toHaveLength(0);
    const select = dom.querySelector<HTMLSelectElement>('.gallery-toolbar select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['', '1', '2', '3', '4', '5', '6']);
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    expect(editor.state.doc.firstChild!.attrs.columns).toBe(3);
    expect(dom.querySelector('[data-gallery="grid"]')!.getAttribute('data-columns')).toBe('3');
    expect([...dom.querySelectorAll('.gallery-break')].map((b) => b.getAttribute('data-row-break'))).toEqual(['narrow', 'wide', 'narrow']);
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(editor.state.doc.firstChild!.attrs.columns).toBeNull();
    expect(dom.querySelector('[data-gallery="grid"]')!.hasAttribute('data-columns')).toBe(false);
  });

  it('hides Per row for a carousel', () => {
    mk(`<div data-gallery="carousel">${imgs}</div>`);
    expect(editor.view.dom.querySelector<HTMLSelectElement>('.gallery-toolbar select')!.hidden).toBe(true);
  });
});

describe('columns on the share page', () => {
  const wideBreaks = (html: string) => (html.match(/data-row-break="wide[^"]*"/g) ?? []).length;

  it('lays a grid of 6 with columns 3 out as 2 rows of 3', () => {
    const html = share(md('data-gallery="grid" data-columns="3"'));
    expect(html).toContain('<div data-gallery="grid" data-columns="3">');
    expect(wideBreaks(html)).toBe(1);
    expect(html).toContain('alt="2"/><span class="gallery-break" data-row-break="wide" aria-hidden="true"></span><img src="https://e.com/3.png"');
  });

  it('keeps data-columns on masonry without breaks, and a grid without it has none', () => {
    const masonry = share(md('data-gallery="masonry" data-columns="4"'));
    expect(masonry).toContain('data-columns="4"');
    expect(masonry).not.toContain('gallery-break');
    const grid = share(md('data-gallery="grid"'));
    expect(grid).not.toContain('data-columns');
    expect(grid).not.toContain('gallery-break');
  });

  it('puts at most N per row in a row gallery', () => {
    expect(wideBreaks(share(md('data-gallery="row" data-columns="2"', 5)))).toBe(2);
  });

  it('drops an invalid data-columns', () => {
    for (const bad of ['0', '9', 'abc']) {
      const html = share(md(`data-gallery="grid" data-columns="${bad}"`));
      expect(html).not.toContain('data-columns');
      expect(html).not.toContain('gallery-break');
    }
  });
});
