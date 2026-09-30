// @vitest-environment happy-dom
/**
 * Code blocks on the public share page (#408): an ordinary code block gets a
 * Copy button that puts the block's exact text on the clipboard; a live block
 * (mermaid, svg, html) does not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import { LiveBlockAwarePre } from '@/components/share/LiveBlockAwarePre';

const CODE = 'const a = 1;\n\n  const b = `two`;';

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

async function mount(markdown: string): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(
      createElement(
        Markdown,
        { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins, components: { pre: LiveBlockAwarePre } },
        markdown,
      ),
    );
  });
  return el;
}

const copyButtons = (el: HTMLElement) => [...el.querySelectorAll('button')].filter((b) => /^Cop/.test(b.textContent));

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('share page code blocks', () => {
  it('copies the exact text of a highlighted code block, without the fence’s trailing newline', async () => {
    const el = await mount('```ts\n' + CODE + '\n```');
    expect(el.querySelector('.hljs-keyword')).not.toBeNull();
    const [button] = copyButtons(el);
    expect(button.textContent).toBe('Copy');

    await act(async () => button.click());

    expect(writeText).toHaveBeenCalledExactlyOnceWith(CODE);
  });

  it('says Copied for 2 seconds after a copy', async () => {
    const el = await mount('```\n' + CODE + '\n```');
    const [button] = copyButtons(el);

    await act(async () => button.click());
    expect(button.textContent).toBe('Copied');

    await act(async () => vi.advanceTimersByTime(1999));
    expect(button.textContent).toBe('Copied');
    await act(async () => vi.advanceTimersByTime(1));
    expect(button.textContent).toBe('Copy');
  });

  it('keeps saying Copy when the browser refuses the clipboard write', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const el = await mount('```\n' + CODE + '\n```');
    const [button] = copyButtons(el);

    await act(async () => button.click());

    expect(button.textContent).toBe('Copy');
  });

  it('gives each code block its own Copy button, and live blocks none', async () => {
    const el = await mount(
      ['```\nplain\n```', '```mermaid\ngraph TD; A-->B\n```', '```svg\n<svg xmlns="http://www.w3.org/2000/svg"/>\n```', '```html\n<p>hi</p>\n```', '```js\nlet x\n```'].join('\n\n'),
    );
    expect(el.querySelectorAll('[data-live-block]')).toHaveLength(3);
    expect(copyButtons(el)).toHaveLength(2);
    expect(el.querySelectorAll('[data-live-block] button').length).toBe(3);
    for (const button of el.querySelectorAll('[data-live-block] button')) expect(button.textContent).toBe('View source');
  });
});
