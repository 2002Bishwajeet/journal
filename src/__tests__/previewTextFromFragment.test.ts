// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createDoc, editorSchema } from '@/lib/agent/editEngine';
import { previewTextFromFragment } from '@/lib/yjs/previewText';
import { CODE_SEPARATOR } from '@/lib/previewText';

const textOf = (md: string) => previewTextFromFragment(createDoc(md).getXmlFragment('prosemirror'));

describe('previewTextFromFragment', () => {
  it('indexes a note link by its label', () => {
    expect(textOf('See [Budget 2026](journal:note/abc123) today')).toBe('See Budget 2026 today');
  });

  it('indexes image alt text', () => {
    expect(textOf('![whiteboard photo](https://example.com/a.png)')).toContain('whiteboard photo');
  });

  it('indexes inline and block math', () => {
    const text = textOf('Energy $E = mc^2$ here\n\n$$\n\\int_0^1 x\n$$\n');
    expect(text).toContain('E = mc^2');
    expect(text).toContain('\\int_0^1 x');
  });

  it('puts a toggle summary first and its code once, after the separator', () => {
    const text = textOf('<details>\n<summary>More</summary>\n\nBody words\n\n```ts\nconst needle = 1;\n```\n\n</details>\n');
    const [prose, code] = text.split(CODE_SEPARATOR);
    expect(prose).toBe('More Body words');
    expect(code).toBe('const needle = 1;');
  });

  it('keeps prose first and code after the separator', () => {
    expect(textOf('Hello\n\n```js\nlet x\n```\n\nWorld')).toBe(`Hello World${CODE_SEPARATOR}let x`);
  });
});

const t = (text: string) => ({ type: 'text', text });
const p = (...content: object[]) => ({ type: 'paragraph', content });

/** One of every block and inline node in the schema. */
const FIXTURE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Title')] },
    p(t('See '), { type: 'noteLink', attrs: { noteId: 'abc', label: 'Budget 2026' } }, t(' today'), { type: 'hardBreak' }, t('after break')),
    p(t('Energy '), { type: 'inlineMath', attrs: { latex: 'E=mc2' } }, t(' and note'), { type: 'footnoteReference', attrs: { id: '1' } }),
    p({ type: 'image', attrs: { src: 'attachment://a', alt: 'whiteboard photo' } }),
    { type: 'gallery', attrs: { layout: 'row' }, content: [{ type: 'image', attrs: { src: 'attachment://b', alt: 'left' } }, { type: 'image', attrs: { src: 'attachment://c', alt: 'right' } }] },
    { type: 'blockMath', attrs: { latex: '\\int x' } },
    { type: 'horizontalRule' },
    { type: 'blockquote', content: [p(t('quoted'))] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('bullet'))] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('ordered'))] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('task'))] }] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('head'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('cell'))] }] },
      ],
    },
    { type: 'callout', attrs: { variant: 'info' }, content: [p(t('callout body'))] },
    {
      type: 'toggle',
      attrs: { summary: 'Summary' },
      content: [p(t('toggle body')), { type: 'codeBlock', content: [t('toggleCode')] }],
    },
    { type: 'linkPreview', attrs: { url: 'https://example.com', title: 'Example site' } },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [t('topCode')] },
    { type: 'footnotes', content: [{ type: 'footnote', attrs: { id: '1' }, content: [p(t('footnote text'))] }] },
  ],
};

describe('previewTextFromFragment — every node', () => {
  const doc = new Y.Doc();
  prosemirrorToYXmlFragment(editorSchema.nodeFromJSON(FIXTURE), doc.getXmlFragment('prosemirror'));
  const text = previewTextFromFragment(doc.getXmlFragment('prosemirror'));

  it('produces the exact string', () => {
    expect(text).toBe(
      'Title See Budget 2026 today after break Energy E=mc2 and note whiteboard photo left right \\int x quoted bullet ordered task head cell callout body ' +
        'Summary toggle body Example site https://example.com footnote text' +
        `${CODE_SEPARATOR}toggleCode topCode`,
    );
  });

  it('is the same text on a device that only has the synced update', () => {
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    expect(previewTextFromFragment(remote.getXmlFragment('prosemirror'))).toBe(text);
  });

  it('is the same text for the editor round trip (fragment -> ProseMirror -> fragment)', () => {
    const editorDoc = new Y.Doc();
    const pm = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), editorSchema);
    prosemirrorToYXmlFragment(pm, editorDoc.getXmlFragment('prosemirror'));
    expect(previewTextFromFragment(editorDoc.getXmlFragment('prosemirror'))).toBe(text);
  });

  it('adds no text for a footnote reference', () => {
    const d = new Y.Doc();
    prosemirrorToYXmlFragment(
      editorSchema.nodeFromJSON({ type: 'doc', content: [p(t('a'), { type: 'footnoteReference', attrs: { id: '1' } }, t('b'))] }),
      d.getXmlFragment('prosemirror'),
    );
    expect(previewTextFromFragment(d.getXmlFragment('prosemirror'))).toBe('ab');
  });

  it('falls back to the URL for a link preview without a title', () => {
    const d = new Y.Doc();
    prosemirrorToYXmlFragment(
      editorSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'linkPreview', attrs: { url: 'https://x.dev' } }] }),
      d.getXmlFragment('prosemirror'),
    );
    expect(previewTextFromFragment(d.getXmlFragment('prosemirror'))).toBe('https://x.dev');
  });
});
