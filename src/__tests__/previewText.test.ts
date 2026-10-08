import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import { proseOnly, CODE_SEPARATOR } from '@/lib/previewText';

function block(name: string, text: string, attrs: Record<string, string> = {}) {
  const el = new Y.XmlElement(name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  el.insert(0, [new Y.XmlText(text)]);
  return el;
}

function blob(...nodes: Y.XmlElement[]): Uint8Array {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').insert(0, nodes);
  return Y.encodeStateAsUpdate(doc);
}

const extract = (b: Uint8Array) => extractPreviewTextFromYjs('id', b);

describe('extractPreviewTextFromYjs prose-first', () => {
  it('puts prose before an html live block that comes first in the document', async () => {
    const text = await extract(
      blob(block('codeBlock', '<div id="cover">hotel</div>', { language: 'html' }), block('paragraph', 'Day one in Lisbon'), block('heading', 'Food')),
    );
    expect(text.startsWith('Day one in Lisbon Food')).toBe(true);
    expect(text).toContain('<div id="cover">hotel</div>');
    expect(proseOnly(text)).toBe('Day one in Lisbon Food');
  });

  it('keeps code searchable after the separator', async () => {
    const text = await extract(blob(block('paragraph', 'hello'), block('codeBlock', 'const zebra = 1;\n\n  x')));
    expect(text).toBe(`hello${CODE_SEPARATOR}const zebra = 1; x`);
  });

  it('shows nothing for a code-only note', async () => {
    const text = await extract(blob(block('codeBlock', 'graph TD; A-->B', { language: 'mermaid' })));
    expect(proseOnly(text)).toBe('');
    expect(text).toContain('A-->B');
  });

  it('is unchanged for prose-only notes', async () => {
    const text = await extract(blob(block('paragraph', 'a   b\n c')));
    expect(text).toBe('a b c');
  });
});
