// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useScrollSelectedIntoView } from '@/hooks/useScrollSelectedIntoView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Menu({ selected }: { selected: number }) {
  const ref = useScrollSelectedIntoView<HTMLDivElement>(selected);
  return (
    <div ref={ref}>
      {[0, 1, 2].map((i) => (
        <button key={i} data-index={i} />
      ))}
    </div>
  );
}

describe('useScrollSelectedIntoView', () => {
  it('scrolls the highlighted item into view with block nearest', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<Menu selected={0} />));
    await act(async () => root.render(<Menu selected={2} />));
    expect(spy).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(spy.mock.contexts.at(-1)).toBe(container.querySelector('[data-index="2"]'));
    await act(async () => root.unmount());
  });
});
