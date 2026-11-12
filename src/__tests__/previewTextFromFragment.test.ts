// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createDoc } from '@/lib/agent/editEngine';
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
