// @vitest-environment happy-dom
/** #1219: note rows get handlers whose identity never changes, so a new layout handler doesn't re-render every row. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStableHandlers } from '@/hooks/useStableHandlers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handlers = { onSelect: (id: string) => void; onArchive?: (id: string) => void };

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

function renderHandlers() {
  const seen: Handlers[] = [];
  const Probe = (props: Handlers) => {
    seen.push(useStableHandlers({ onSelect: props.onSelect, onArchive: props.onArchive }));
    return null;
  };
  root = createRoot(document.createElement('div'));
  const render = (props: Handlers) => act(() => root!.render(createElement(Probe, props)));
  return { seen, render };
}

describe('useStableHandlers', () => {
  it('keeps each handler identity across renders and calls the latest handler', () => {
    const { seen, render } = renderHandlers();
    const first = vi.fn();
    const second = vi.fn();
    render({ onSelect: first, onArchive: vi.fn() });
    render({ onSelect: second, onArchive: vi.fn() });

    expect(seen.at(-1)!.onSelect).toBe(seen[0].onSelect);
    expect(seen.at(-1)!.onArchive).toBe(seen[0].onArchive);
    seen[0].onSelect('note-1');
    expect(second).toHaveBeenCalledWith('note-1');
    expect(first).not.toHaveBeenCalled();
  });

  it('leaves a missing handler undefined and stabilises it once it is passed', () => {
    const { seen, render } = renderHandlers();
    render({ onSelect: vi.fn() });
    expect(seen.at(-1)!.onArchive).toBeUndefined();

    const archive = vi.fn();
    render({ onSelect: vi.fn(), onArchive: archive });
    const stable = seen.at(-1)!.onArchive!;
    render({ onSelect: vi.fn(), onArchive: vi.fn() });
    expect(seen.at(-1)!.onArchive).toBe(stable);
    render({ onSelect: vi.fn(), onArchive: archive });
    stable('note-2');
    expect(archive).toHaveBeenCalledWith('note-2');
  });
});
