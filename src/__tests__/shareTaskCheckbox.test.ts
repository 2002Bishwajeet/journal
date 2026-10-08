import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import { ReaderTaskCheckbox } from '@/components/share/ReaderTaskCheckbox';

describe('share page task checkboxes (#517)', () => {
  const render = (md: string) =>
    renderToStaticMarkup(
      createElement(Markdown, {
        remarkPlugins: shareRemarkPlugins,
        rehypePlugins: shareRehypePlugins,
        components: { input: ReaderTaskCheckbox },
        children: md,
      }),
    );

  it('renders enabled checkboxes that keep the saved state as their start value', () => {
    const html = render('- [x] done\n- [ ] todo');
    const boxes = html.match(/<input[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.includes('type="checkbox"') && !b.includes('disabled'))).toBe(true);
    expect(boxes[0]).toContain('checked');
    expect(boxes[1]).not.toContain('checked');
  });
});
