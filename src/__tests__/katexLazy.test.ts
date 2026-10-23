// @vitest-environment happy-dom
/** #673: the `katex` the math nodes get shows raw LaTeX, then renders once KaTeX has loaded. */
import { describe, it, expect, vi } from 'vitest';

// A stub KaTeX that records each render and, like KaTeX, empties the element and then
// throws on invalid LaTeX.
const renders = vi.hoisted(() => [] as unknown[][]);
vi.mock('katex', () => ({
  default: {
    render: (...args: unknown[]) => {
      renders.push(args);
      (args[1] as HTMLElement).textContent = '';
      if (args[0] === '\\frac{') throw new Error('KaTeX parse error');
    },
  },
}));
vi.mock('katex/dist/katex.min.css', () => ({}));

import katexLazy from '@/lib/katexLazy';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('katexLazy.render', () => {
  it('writes the raw LaTeX first, then renders it with KaTeX', async () => {
    const el = document.createElement('span');
    katexLazy.render('E = mc^2', el, { displayMode: true });
    expect(el.textContent).toBe('E = mc^2');
    expect(renders).toEqual([]);

    await settle();
    expect(renders).toEqual([['E = mc^2', el, { displayMode: true }]]);
  });

  it('keeps the raw LaTeX when KaTeX throws', async () => {
    const el = document.createElement('div');
    expect(() => katexLazy.render('\\frac{', el)).not.toThrow();

    await settle();
    expect(renders.at(-1)).toEqual(['\\frac{', el, undefined]);
    expect(el.textContent).toBe('\\frac{');
  });
});
