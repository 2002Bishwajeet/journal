// @vitest-environment happy-dom
/**
 * Link preview cards (#173): pasting a lone http(s) URL into an empty paragraph
 * inserts a `linkPreview` node whose attrs carry title/description/image in
 * the Yjs doc. Markdown (share page, export) gets a link + quote and never the
 * image; the search index gets title + URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension, undo } from '@/components/editor/plugins/collaboration';
import { isPreviewableUrl, dataUriToBlob, previewToMarkdown, toPreviewAttrs } from '@/lib/editor/linkPreview';
import { fetchLinkPreview } from '@/hooks/links/useLinkPreviewFetch';
import { extractMarkdownFromYjs, extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';

const media = vi.hoisted(() => ({
  getLinkPreview: vi.fn(),
  resizeImageFromBlob: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@homebase-id/js-lib/media')>()),
  getLinkPreview: media.getLinkPreview,
  resizeImageFromBlob: media.resizeImageFromBlob,
}));

const client = {} as DotYouClient;

describe('isPreviewableUrl', () => {
  it.each(['https://a.com/x', 'http://a.com', '  https://a.com/x  '])('accepts %s', (url) => {
    expect(isPreviewableUrl(url)).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/rel', 'a.com b.com', 'https://a.com\nhttps://b.com', '', 'a.com'])(
    'rejects %j',
    (text) => {
      expect(isPreviewableUrl(text)).toBe(false);
    },
  );
});

describe('dataUriToBlob', () => {
  it('returns null for a remote URL', () => {
    expect(dataUriToBlob('https://x/y.png')).toBeNull();
  });

  it('returns null for a non-image data URI', () => {
    expect(dataUriToBlob('data:text/html;base64,PGI+')).toBeNull();
  });

  it('decodes a base64 image data URI', async () => {
    const blob = dataUriToBlob('data:image/png;base64,AQID');
    expect(blob?.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1, 2, 3]);
  });
});

describe('previewToMarkdown', () => {
  it('escapes brackets in the title and never contains the image', () => {
    const attrs = toPreviewAttrs(
      { url: 'https://a.com', title: 'A [b] \\ c', description: 'Desc', imageUrl: 'ignored' },
      'data:image/webp;base64,AAAA',
    );
    const md = previewToMarkdown(attrs);
    expect(md).toBe('[A \\[b\\] \\\\ c](https://a.com)\n\n> Desc');
    expect(md).not.toContain('data:');
  });

  it('collapses whitespace in a multi-line title so metadata cannot add blocks', () => {
    const md = previewToMarkdown({ url: 'https://a.com', title: 'a\n\n# b\n> c', description: '' });
    expect(md).toBe('[a # b > c](https://a.com)');
    expect(md).not.toContain('\n');
  });

  it('falls back to the URL for a whitespace-only title', () => {
    expect(previewToMarkdown({ url: 'https://a.com', title: ' \n ', description: '' })).toBe('[https://a.com](https://a.com)');
  });

  it('falls back to the URL as link text and omits an empty description', () => {
    expect(previewToMarkdown({ url: 'https://a.com', title: '', description: '' })).toBe('[https://a.com](https://a.com)');
  });
});

describe('fetchLinkPreview', () => {
  beforeEach(() => {
    media.getLinkPreview.mockReset();
    media.resizeImageFromBlob.mockReset();
  });

  it('returns null when the SDK returns null', async () => {
    media.getLinkPreview.mockResolvedValue(null);
    expect(await fetchLinkPreview(client, 'https://a.com')).toBeNull();
  });

  it('drops a non-data: imageUrl without resizing it', async () => {
    media.getLinkPreview.mockResolvedValue({ url: 'https://a.com', title: 'T', imageUrl: 'https://cdn/x.png' });
    const result = await fetchLinkPreview(client, 'https://a.com');
    expect(result).toMatchObject({ url: 'https://a.com', title: 'T', description: '', image: null });
    expect(media.resizeImageFromBlob).not.toHaveBeenCalled();
  });

  it('shrinks a data: image to a webp data URI', async () => {
    media.getLinkPreview.mockResolvedValue({ url: 'https://a.com', title: 'T', imageUrl: 'data:image/png;base64,AQID' });
    media.resizeImageFromBlob.mockResolvedValue({ blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }) });
    const result = await fetchLinkPreview(client, 'https://a.com');
    expect(media.resizeImageFromBlob).toHaveBeenCalledWith(expect.any(Blob), 70, 480, undefined, 'webp', false, 40_000);
    expect(result?.image).toMatch(/^data:image\/webp;base64,/);
  });

  it('drops an image still over the size cap, and a failed resize', async () => {
    media.getLinkPreview.mockResolvedValue({ url: 'https://a.com', title: 'T', imageUrl: 'data:image/png;base64,AQID' });
    media.resizeImageFromBlob.mockResolvedValueOnce({ blob: new Blob([new Uint8Array(50_000)], { type: 'image/webp' }) });
    expect((await fetchLinkPreview(client, 'https://a.com'))?.image).toBeNull();

    media.resizeImageFromBlob.mockRejectedValueOnce(new Error('decode failed'));
    expect((await fetchLinkPreview(client, 'https://a.com'))?.image).toBeNull();
  });

  it('keeps the pasted URL rather than the one the extractor echoes back', async () => {
    media.getLinkPreview.mockResolvedValue({ url: 'javascript:alert(1)', title: 'T' });
    expect((await fetchLinkPreview(client, 'https://a.com'))?.url).toBe('https://a.com');
  });
});

describe('Yjs serializers', () => {
  function blobWithPreview(): Uint8Array {
    const doc = new Y.Doc();
    const el = new Y.XmlElement('linkPreview');
    el.setAttribute('url', 'https://a.com/post');
    el.setAttribute('title', 'Title');
    el.setAttribute('description', 'Desc');
    el.setAttribute('image', 'data:image/webp;base64,QUJD');
    doc.getXmlFragment('prosemirror').insert(0, [el]);
    return Y.encodeStateAsUpdate(doc);
  }

  it('extractMarkdownFromYjs outputs a link and a quote without the image', async () => {
    const md = await extractMarkdownFromYjs('n', blobWithPreview());
    expect(md).toContain('[Title](https://a.com/post)');
    expect(md).toContain('> Desc');
    expect(md).not.toContain('base64');
  });

  it('renders on the share page as a link plus a quote with no data:image', async () => {
    const md = await extractMarkdownFromYjs('n', blobWithPreview());
    const html = renderToStaticMarkup(
      createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, md),
    );
    expect(html).toContain('href="https://a.com/post"');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('data:image');
  });

  it('extractPreviewTextFromYjs includes the title and the URL', async () => {
    const text = await extractPreviewTextFromYjs('n', blobWithPreview());
    expect(text).toContain('Title');
    expect(text).toContain('https://a.com/post');
  });
});

describe('linkPreview node', () => {
  let editor: Editor;

  beforeEach(() => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({ element, extensions: createBaseExtensions(), content: '<p></p>' });
  });

  afterEach(() => editor.destroy());

  function paste(text: string) {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    editor.view.pasteText(text, new ClipboardEvent('paste', { clipboardData }));
  }

  const findNode = (type: string) => JSON.stringify(editor.getJSON()).includes(`"type":"${type}"`);

  it('pasting a URL into an empty paragraph inserts a linkPreview node', () => {
    paste('https://a.com');
    const content = editor.getJSON().content ?? [];
    expect(content[0]).toMatchObject({ type: 'linkPreview', attrs: { url: 'https://a.com' } });
    // The URL isn't also pasted as text (StarterKit's trailing node may add an empty paragraph).
    expect(findNode('text')).toBe(false);
  });

  it('pasting a URL after text keeps the Link mark behaviour', () => {
    editor.commands.setContent('<p>hello </p>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    paste('https://a.com');
    expect(findNode('linkPreview')).toBe(false);
    const para = editor.getJSON().content?.[0];
    const marks = para?.content?.flatMap((n) => n.marks ?? []) ?? [];
    expect(marks).toContainEqual(expect.objectContaining({ type: 'link', attrs: expect.objectContaining({ href: 'https://a.com' }) }));
  });

  it('pasting non-URL text into an empty paragraph inserts plain text', () => {
    paste('javascript:alert(1)');
    expect(findNode('linkPreview')).toBe(false);
  });

  it('convert replaces the card with a paragraph holding a link', () => {
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'linkPreview', attrs: { url: 'https://a.com', title: 'A site' } }],
    });
    expect(editor.commands.convertLinkPreviewToLink(0)).toBe(true);
    expect(findNode('linkPreview')).toBe(false);
    expect(editor.getJSON().content?.[0]).toEqual({
      type: 'paragraph',
      attrs: expect.anything(),
      content: [
        {
          type: 'text',
          text: 'A site',
          marks: [{ type: 'link', attrs: expect.objectContaining({ href: 'https://a.com' }) }],
        },
      ],
    });
  });

  it('parses pasted card HTML but drops a non-http(s) data-url', () => {
    editor.commands.setContent('<div data-link-preview data-url="javascript:alert(1)"></div>');
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'linkPreview', attrs: { url: '' } });
  });
});

describe('linkPreview in a collaborative (Yjs) editor', () => {
  const card = {
    type: 'linkPreview',
    attrs: { url: 'https://a.com', title: 'A site', description: 'Desc', image: 'data:image/webp;base64,QUJD', imageWidth: 480, imageHeight: 240 },
  };

  function makeEditor(fragment: Y.XmlFragment) {
    const element = document.createElement('div');
    return new Editor({ element, extensions: [...createBaseExtensions(), createCollaborationExtension(fragment)] });
  }

  it('round-trips its attrs through a Yjs update into a fresh editor', () => {
    const ydoc = new Y.Doc();
    const editor = makeEditor(ydoc.getXmlFragment('prosemirror'));
    editor.commands.setContent({ type: 'doc', content: [card] });

    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
    const fresh = makeEditor(copy.getXmlFragment('prosemirror'));
    expect(fresh.getJSON().content?.[0]).toEqual(card);
    fresh.destroy();
    editor.destroy();
  });

  it('undo after convert brings the card back', async () => {
    const editor = makeEditor(new Y.Doc().getXmlFragment('prosemirror'));
    editor.commands.setContent({ type: 'doc', content: [card] });
    // Separate undo step from the insertion (UndoManager batches ~500ms).
    await new Promise((r) => setTimeout(r, 600));

    editor.commands.convertLinkPreviewToLink(0);
    expect(editor.getJSON().content?.[0]?.type).toBe('paragraph');

    expect(undo(editor.state)).toBe(true);
    expect(editor.getJSON().content?.[0]).toEqual(card);
    editor.destroy();
  });
});
