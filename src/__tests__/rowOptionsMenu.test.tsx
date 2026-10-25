// @vitest-environment happy-dom
/** #777: the touch options button shares the context menu's item list and stays out of the row's click. */
import { describe, it, expect, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Pin } from 'lucide-react';
import { RowOptionsMenu } from '@/components/ui/context-menu-wrapper';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('RowOptionsMenu', () => {
  it('renders a labelled, touch-only button that does not trigger the row click', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onRow = vi.fn();
    document.body.addEventListener('click', onRow);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(RowOptionsMenu, { label: 'Note options', items: [{ label: 'Pin', icon: Pin, action: vi.fn() }] }),
      );
    });
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Note options"]')!;
    expect(button).not.toBeNull();
    expect(button.className).toContain('pointer-coarse:flex');
    expect(button.className).toContain('hidden');
    await act(async () => button.click());
    expect(onRow).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    document.body.removeEventListener('click', onRow);
    host.remove();
  });
});
