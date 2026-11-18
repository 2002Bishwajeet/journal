// @vitest-environment happy-dom
/**
 * #1387: an image node stores its own pixel size so its box is held before the bytes
 * arrive. The size round-trips through markdown (export, the MCP) and the editor's HTML;
 * a note from before gets it from the file header or the first load, in one write.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema, toMarkdown, createDoc } from '@/lib/agent/editEngine';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { naturalSizeAttrs, payloadPreviews, readNaturalSize, sizeToBackfill } from '@/lib/images/imageSize';

const roundTrip = (md: string) => toMarkdown(createDoc(md));
const imageAttrs = (md: string) => {
  const doc = yXmlFragmentToProseMirrorRootNode(createDoc(md).getXmlFragment('prosemirror'), editorSchema);
  let attrs: Record<string, unknown> | undefined;
  doc.descendants((n) => {
    if (n.type.name === 'image') attrs = n.attrs;
  });
  return attrs;
};

describe('image size attrs', () => {
  it('reads a size only when both sides are positive numbers', () => {
    expect(readNaturalSize({ naturalWidth: 800, naturalHeight: 400 })).toEqual({ width: 800, height: 400 });
    expect(readNaturalSize({ naturalWidth: '800', naturalHeight: '400' })).toEqual({ width: 800, height: 400 });
    expect(readNaturalSize({ naturalWidth: 800 })).toBeUndefined();
    expect(readNaturalSize({ naturalWidth: 0, naturalHeight: 400 })).toBeUndefined();
    expect(readNaturalSize({ naturalWidth: 'wide', naturalHeight: -4 })).toBeUndefined();
    expect(readNaturalSize({})).toBeUndefined();
  });

  it('writes node attrs for a size and clears them for none', () => {
    expect(naturalSizeAttrs({ width: 800, height: 400 })).toEqual({ naturalWidth: 800, naturalHeight: 400 });
    expect(naturalSizeAttrs(undefined)).toEqual({ naturalWidth: null, naturalHeight: null });
    expect(naturalSizeAttrs({ width: 0, height: 400 })).toEqual({ naturalWidth: null, naturalHeight: null });
  });
});

describe('image size in markdown (#1387)', () => {
  it('serializes a measured image as an <img> with data-width and data-height, and parses it back', () => {
    const md = '<img src="attachment://f/jrnl_img0" alt="A cat" data-width="1600" data-height="900">';
    expect(imageAttrs(md)).toMatchObject({ src: 'attachment://f/jrnl_img0', alt: 'A cat', naturalWidth: 1600, naturalHeight: 900 });
    expect(roundTrip(md)).toBe(md);
  });

  it('keeps the size next to width, float, caption and edits', () => {
    const md =
      '<img src="attachment://f/jrnl_img0" alt="a" width="320" data-align="right" data-caption="Cat" data-width="1600" data-height="900" data-rotate="90">';
    expect(imageAttrs(md)).toMatchObject({ width: 320, align: 'right', caption: 'Cat', naturalWidth: 1600, naturalHeight: 900, rotate: 90 });
    expect(roundTrip(md)).toBe(md);
  });

  it('leaves an image with no size as ![alt](src), and drops half a size', () => {
    expect(roundTrip('![A cat](attachment://f/jrnl_img0)')).toBe('![A cat](attachment://f/jrnl_img0)');
    const half = '<img src="attachment://f/jrnl_img0" alt="a" data-width="1600">';
    expect(imageAttrs(half)).toMatchObject({ naturalWidth: null, naturalHeight: null });
    expect(roundTrip(half)).toBe('![a](attachment://f/jrnl_img0)');
  });

  it('keeps the size in the editor HTML, apart from the drag-resized width', () => {
    const editor = new Editor({ extensions: createBaseExtensions(), content: '<p></p>' });
    editor.commands.insertContent({ type: 'image', attrs: { src: 'https://e.com/a.png', width: 320, naturalWidth: 1600, naturalHeight: 900 } });
    const html = editor.getHTML();
    expect(html).toContain('data-width="1600"');
    expect(html).toContain('data-height="900"');
    expect(html).toContain('width: 320px');

    const back = new Editor({ extensions: createBaseExtensions(), content: html });
    let attrs: Record<string, unknown> | undefined;
    back.state.doc.descendants((n) => {
      if (n.type.name === 'image') attrs = n.attrs;
    });
    expect(attrs).toMatchObject({ width: 320, naturalWidth: 1600, naturalHeight: 900 });
    editor.destroy();
    back.destroy();
  });
});

describe('backfilling a size (#1387)', () => {
  const header = { width: 1600, height: 900 };
  const loaded = { width: 1280, height: 720 };

  it('does nothing for a node that already has a size', () => {
    expect(sizeToBackfill({ stored: { width: 800, height: 400 }, fromHeader: header, loaded })).toBeNull();
  });

  it('takes the size the note file lists for the payload first', () => {
    expect(sizeToBackfill({ fromHeader: header, loaded })).toEqual(header);
  });

  it('falls back to the first loaded image, and to nothing while neither is known', () => {
    expect(sizeToBackfill({ loaded })).toEqual(loaded);
    expect(sizeToBackfill({})).toBeNull();
  });
});

describe('payload previews from the note file header', () => {
  const tiny = { contentType: 'image/jpeg' as const, content: 'AAAA', pixelWidth: 20, pixelHeight: 11 };
  const thumbs = [
    { contentType: 'image/webp' as const, pixelWidth: 320, pixelHeight: 180 },
    { contentType: 'image/webp' as const, pixelWidth: 1600, pixelHeight: 900 },
    { contentType: 'image/webp' as const, pixelWidth: 640, pixelHeight: 360 },
  ];

  it('lists the tiny thumbnail, every thumbnail size and the largest as the size', () => {
    const previews = payloadPreviews([
      { key: 'jrnl_txt', previewThumbnail: undefined, thumbnails: [] },
      { key: 'jrnl_img0', previewThumbnail: tiny, thumbnails: thumbs },
    ]);
    expect(Object.keys(previews)).toEqual(['jrnl_img0']);
    expect(previews.jrnl_img0.thumb).toBe(tiny);
    expect(previews.jrnl_img0.size).toEqual({ width: 1600, height: 900 });
    expect(previews.jrnl_img0.sizes).toHaveLength(3);
  });

  it('has no size for a payload with a tiny thumbnail only (its own size is rounded to a few pixels)', () => {
    const previews = payloadPreviews([{ key: 'jrnl_img1', previewThumbnail: tiny, thumbnails: [] }]);
    expect(previews.jrnl_img1.thumb).toBe(tiny);
    expect(previews.jrnl_img1.size).toBeUndefined();
  });

  it('is empty for a file with no payloads', () => {
    expect(payloadPreviews(undefined)).toEqual({});
  });
});
